/**
 * macOS infrastructure collector.
 * Generates a bash script that outputs JSON to stdout.
 * Uses macOS-native commands (lsof, sw_vers, ipconfig, etc.).
 */

// Using string concatenation to avoid JS template literal parsing of shell ${ } syntax
/* eslint-disable prefer-template */
export const MACOS_COLLECTOR_SCRIPT =
  "#!/bin/bash\n" +
  "set -o pipefail\n" +
  "\n" +
  "HOSTNAME_VAL=$(hostname 2>/dev/null || echo 'unknown')\n" +
  "ARCH_VAL=$(uname -m 2>/dev/null)\n" +
  'case "$ARCH_VAL" in\n' +
  '  x86_64) ARCH_JSON="amd64" ;;\n' +
  '  aarch64|arm64) ARCH_JSON="arm64" ;;\n' +
  '  *) ARCH_JSON="$ARCH_VAL" ;;\n' +
  "esac\n" +
  "\n" +
  "# macOS version via sw_vers\n" +
  "OS_NAME=$(sw_vers -productName 2>/dev/null || echo 'macOS')\n" +
  "OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo '')\n" +
  "\n" +
  "# IP address — find the default route interface, then get its IP\n" +
  "DEFAULT_IFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')\n" +
  'IP_ADDR=""\n' +
  'if [ -n "$DEFAULT_IFACE" ]; then\n' +
  '  IP_ADDR=$(ipconfig getifaddr "$DEFAULT_IFACE" 2>/dev/null || echo "")\n' +
  "fi\n" +
  "# Fallback: try common interfaces\n" +
  'if [ -z "$IP_ADDR" ]; then\n' +
  "  for iface in en0 en1 en2; do\n" +
  '    IP_ADDR=$(ipconfig getifaddr "$iface" 2>/dev/null || echo "")\n' +
  '    [ -n "$IP_ADDR" ] && break\n' +
  "  done\n" +
  "fi\n" +
  "\n" +
  "# -- Collectors array --\n" +
  'COLLECTORS="[]"\n' +
  "add_collector() {\n" +
  '  local name="$1" status="$2" error="$3" count="$4"\n' +
  "  local entry\n" +
  '  entry=$(printf \'{"name":"%s","status":"%s"\' "$name" "$status")\n' +
  '  [ -n "$error" ] && entry="$entry,\\"error\\":\\"$error\\""\n' +
  '  [ -n "$count" ] && entry="$entry,\\"count\\":$count"\n' +
  '  entry="$entry}"\n' +
  '  if [ "$COLLECTORS" = "[]" ]; then\n' +
  '    COLLECTORS="[$entry]"\n' +
  "  else\n" +
  // Use dollar-sign-brace carefully — this is shell string manipulation, not JS
  '    COLLECTORS="${COLLECTORS%]},$entry]"\n' +
  "  fi\n" +
  "}\n" +
  "\n" +
  "# -- Ports (lsof) --\n" +
  'PORTS="[]"\n' +
  "PORT_COUNT=0\n" +
  "# lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n" +
  "# NAME field for TCP LISTEN looks like: *:8080 (LISTEN)\n" +
  "# $(NF-1) is the addr:port, $NF is (LISTEN)\n" +
  "LSOF_RAW=$(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | tail -n +2)\n" +
  'if [ -n "$LSOF_RAW" ]; then\n' +
  "  while IFS= read -r line; do\n" +
  '    [ -z "$line" ] && continue\n' +
  "    proc=$(echo \"$line\" | awk '{print $1}')\n" +
  "    pid=$(echo \"$line\" | awk '{print $2}')\n" +
  "    name_field=$(echo \"$line\" | awk '{print $(NF-1)}')\n" +
  '    port=$(echo "$name_field" | rev | cut -d: -f1 | rev)\n' +
  '    addr=$(echo "$name_field" | rev | cut -d: -f2- | rev)\n' +
  '    [ "$addr" = "*" ] && addr="0.0.0.0"\n' +
  "\n" +
  '    entry=$(printf \'{"port":%s,"protocol":"tcp","address":"%s"\' "$port" "$addr")\n' +
  '    [ -n "$proc" ] && entry="$entry,\\"process\\":\\"$proc\\""\n' +
  '    [ -n "$pid" ] && entry="$entry,\\"pid\\":$pid"\n' +
  '    entry="$entry}"\n' +
  "\n" +
  '    if [ "$PORTS" = "[]" ]; then\n' +
  '      PORTS="[$entry]"\n' +
  "    else\n" +
  '      PORTS="${PORTS%]},$entry]"\n' +
  "    fi\n" +
  "    PORT_COUNT=$((PORT_COUNT + 1))\n" +
  '  done <<< "$LSOF_RAW"\n' +
  '  add_collector "ports" "ok" "" "$PORT_COUNT"\n' +
  "else\n" +
  '  add_collector "ports" "ok" "" "0"\n' +
  "fi\n" +
  "\n" +
  "# -- Realms --\n" +
  'REALMS="[]"\n' +
  "\n" +
  "# Docker\n" +
  "if command -v docker >/dev/null 2>&1; then\n" +
  "  DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '')\n" +
  '  if [ -n "$DOCKER_VERSION" ]; then\n' +
  '    REALMS=\'[{"type":"docker-engine","version":"\'"$DOCKER_VERSION"\'","status":"running"}]\'\n' +
  '    add_collector "docker" "ok" ""\n' +
  "  else\n" +
  '    add_collector "docker" "failed" "docker daemon not reachable"\n' +
  "  fi\n" +
  "else\n" +
  '  add_collector "docker" "skipped" "docker not installed"\n' +
  "fi\n" +
  "\n" +
  "# Homebrew\n" +
  "if command -v brew >/dev/null 2>&1; then\n" +
  "  BREW_VERSION=$(brew --version 2>/dev/null | head -1 | sed 's/Homebrew //' || echo '')\n" +
  '  if [ -n "$BREW_VERSION" ]; then\n' +
  '    entry=\'{"type":"process","version":"\'"$BREW_VERSION"\'","status":"running"}\'\n' +
  '    if [ "$REALMS" = "[]" ]; then\n' +
  '      REALMS="[$entry]"\n' +
  "    else\n" +
  '      REALMS="${REALMS%]},$entry]"\n' +
  "    fi\n" +
  '    add_collector "homebrew" "ok" ""\n' +
  "  fi\n" +
  "fi\n" +
  "\n" +
  "# -- Compose Projects --\n" +
  'COMPOSE_PROJECTS="[]"\n' +
  'SERVICES="[]"\n' +
  "SVC_COUNT=0\n" +
  "\n" +
  "if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then\n" +
  '  COMPOSE_JSON=$(docker compose ls --format json 2>/dev/null || echo "[]")\n' +
  "\n" +
  "  if command -v python3 >/dev/null 2>&1; then\n" +
  '    RESULT=$(echo "$COMPOSE_JSON" | python3 -c "\n' +
  "import json, subprocess, sys\n" +
  "\n" +
  "try:\n" +
  "    projects = json.load(sys.stdin)\n" +
  "    if not isinstance(projects, list): projects = []\n" +
  "except:\n" +
  "    projects = []\n" +
  "\n" +
  "compose_projects = []\n" +
  "services = []\n" +
  "\n" +
  "for p in projects:\n" +
  "    name = p.get('Name', '')\n" +
  "    status = p.get('Status', '')\n" +
  "\n" +
  "    try:\n" +
  "        ps_out = subprocess.check_output(\n" +
  "            ['docker', 'compose', '-p', name, 'ps', '--format', 'json'],\n" +
  "            stderr=subprocess.DEVNULL, timeout=10\n" +
  "        ).decode()\n" +
  "        containers = []\n" +
  "        for line in ps_out.strip().splitlines():\n" +
  "            if not line.strip(): continue\n" +
  "            try:\n" +
  "                c = json.loads(line)\n" +
  "                svc_name = c.get('Service', c.get('Name', ''))\n" +
  "                svc_status = c.get('State', 'unknown')\n" +
  "                port_nums = []\n" +
  "                ports_str = c.get('Ports', '') or c.get('Publishers', '')\n" +
  "                if isinstance(ports_str, list):\n" +
  "                    for pp in ports_str:\n" +
  "                        pub = pp.get('PublishedPort', 0)\n" +
  "                        if pub > 0: port_nums.append(pub)\n" +
  "                elif isinstance(ports_str, str) and ports_str:\n" +
  "                    import re\n" +
  "                    for m in re.finditer(r'(?::)(\\d+)->', ports_str):\n" +
  "                        port_nums.append(int(m.group(1)))\n" +
  "                containers.append(svc_name)\n" +
  "                services.append({\n" +
  "                    'name': svc_name,\n" +
  "                    'displayName': svc_name,\n" +
  "                    'realmType': 'docker',\n" +
  "                    'status': svc_status,\n" +
  "                    'ports': sorted(set(port_nums)),\n" +
  "                    'image': c.get('Image', ''),\n" +
  "                    'composeProject': name,\n" +
  "                })\n" +
  "            except: pass\n" +
  "    except: containers = []\n" +
  "\n" +
  "    compose_projects.append({\n" +
  "        'name': name,\n" +
  "        'status': status,\n" +
  "        'services': containers,\n" +
  "    })\n" +
  "\n" +
  "print(json.dumps({'projects': compose_projects, 'services': services}))\n" +
  '" 2>/dev/null)\n' +
  "\n" +
  '    if [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then\n' +
  "      COMPOSE_PROJECTS=$(echo \"$RESULT\" | python3 -c \"import json,sys; d=json.load(sys.stdin); print(json.dumps(d['projects']))\" 2>/dev/null || echo '[]')\n" +
  "      COMPOSE_SERVICES=$(echo \"$RESULT\" | python3 -c \"import json,sys; d=json.load(sys.stdin); print(json.dumps(d['services']))\" 2>/dev/null || echo '[]')\n" +
  '      SERVICES="$COMPOSE_SERVICES"\n' +
  "      SVC_COUNT=$(echo \"$RESULT\" | python3 -c \"import json,sys; d=json.load(sys.stdin); print(len(d['services']))\" 2>/dev/null || echo '0')\n" +
  "    fi\n" +
  "  fi\n" +
  "fi\n" +
  "\n" +
  "# -- Processes with listening ports (non-compose, non-system) --\n" +
  "# Build services from lsof data, skipping Apple system daemons and docker-managed processes\n" +
  'if [ -n "$LSOF_RAW" ] && command -v python3 >/dev/null 2>&1; then\n' +
  '  PROC_SVCS=$(echo "$LSOF_RAW" | python3 -c "\n' +
  "import json, sys\n" +
  "\n" +
  "# Apple system daemons to skip\n" +
  "DENYLIST = {\n" +
  "    'rapportd', 'airplayd', 'sharingd', 'ControlCenter', 'SystemUIServer',\n" +
  "    'UserEventAgent', 'launchd', 'mDNSResponder', 'bluetoothd', 'WiFiAgent',\n" +
  "    'locationd', 'identityservicesd', 'remotepairingd', 'remoted',\n" +
  "    'loginwindow', 'WindowServer', 'coreautha', 'symptomsd', 'configd',\n" +
  "    'apsd', 'cloudd', 'CommCenter', 'kernelmanagerd',\n" +
  "}\n" +
  "\n" +
  "# Also skip docker-related (already captured via compose)\n" +
  "DOCKER_PROCS = {'com.docke', 'docker', 'vpnkit', 'dockerd', 'containerd'}\n" +
  "\n" +
  "# Parse lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (LISTEN)\n" +
  "# parts[-1] is '(LISTEN)', parts[-2] is addr:port like '*:8080'\n" +
  "pid_info = {}  # pid -> {name, ports[]}\n" +
  "for line in sys.stdin:\n" +
  "    parts = line.split()\n" +
  "    if len(parts) < 10: continue\n" +
  "    proc_name = parts[0]\n" +
  "    pid = parts[1]\n" +
  "    name_field = parts[-2]\n" +
  "\n" +
  "    if proc_name in DENYLIST or proc_name in DOCKER_PROCS: continue\n" +
  "    if proc_name.startswith('com.apple'): continue\n" +
  "\n" +
  "    try:\n" +
  "        port = int(name_field.rsplit(':', 1)[-1])\n" +
  "    except: continue\n" +
  "\n" +
  "    if pid not in pid_info:\n" +
  "        pid_info[pid] = {'name': proc_name, 'ports': set()}\n" +
  "    pid_info[pid]['ports'].add(port)\n" +
  "\n" +
  "services = []\n" +
  "for pid, info in pid_info.items():\n" +
  "    services.append({\n" +
  "        'name': info['name'],\n" +
  "        'displayName': info['name'],\n" +
  "        'realmType': 'process',\n" +
  "        'status': 'running',\n" +
  "        'ports': sorted(info['ports']),\n" +
  "        'pid': int(pid),\n" +
  "    })\n" +
  "\n" +
  "print(json.dumps(services))\n" +
  '" 2>/dev/null || echo "[]")\n' +
  "\n" +
  '  if [ -n "$PROC_SVCS" ] && [ "$PROC_SVCS" != "[]" ]; then\n' +
  '    if [ "$SERVICES" = "[]" ]; then\n' +
  '      SERVICES="$PROC_SVCS"\n' +
  "    else\n" +
  '      SERVICES=$(printf \'%s\\n%s\' "$SERVICES" "$PROC_SVCS" | python3 -c "\n' +
  "import json, sys\n" +
  "lines = sys.stdin.read().strip().splitlines()\n" +
  "a = json.loads(lines[0])\n" +
  "b = json.loads(lines[1])\n" +
  "print(json.dumps(a + b))\n" +
  '" 2>/dev/null || echo "$SERVICES")\n' +
  "    fi\n" +
  '    PROC_COUNT=$(echo "$PROC_SVCS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo \'0\')\n' +
  "    SVC_COUNT=$((SVC_COUNT + PROC_COUNT))\n" +
  "  fi\n" +
  "fi\n" +
  "\n" +
  "# -- Emit final JSON --\n" +
  "cat <<ENDJSON\n" +
  "{\n" +
  '  "scannedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",\n' +
  '  "os": "macos",\n' +
  '  "arch": "$ARCH_JSON",\n' +
  '  "hostname": "$HOSTNAME_VAL",\n' +
  '  "ipAddress": "$IP_ADDR",\n' +
  '  "realms": $REALMS,\n' +
  '  "services": $SERVICES,\n' +
  '  "ports": $PORTS,\n' +
  '  "composeProjects": $COMPOSE_PROJECTS,\n' +
  '  "collectors": $COLLECTORS\n' +
  "}\n" +
  "ENDJSON\n"
