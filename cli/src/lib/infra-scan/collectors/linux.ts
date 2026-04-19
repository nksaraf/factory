/**
 * Linux infrastructure collector.
 * Generates a self-contained shell script that outputs JSON to stdout.
 */

/**
 * Shell script that collects infrastructure data on a Linux host.
 * Outputs a single JSON object to stdout.
 * Designed to work on any Linux with bash and standard coreutils.
 */
export const LINUX_COLLECTOR_SCRIPT = `#!/bin/bash
set -o pipefail

# Collect all data into variables, then emit JSON at the end.
# Each collector writes to a temp var; failures are captured, not fatal.

HOSTNAME_VAL=$(hostname 2>/dev/null || echo "unknown")
ARCH_VAL=$(uname -m 2>/dev/null)
case "$ARCH_VAL" in
  x86_64) ARCH_JSON="amd64" ;;
  aarch64|arm64) ARCH_JSON="arm64" ;;
  *) ARCH_JSON="$ARCH_VAL" ;;
esac

OS_VERSION=$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || echo "linux")

# ── Collectors array (track status) ──
COLLECTORS="[]"
add_collector() {
  local name="$1" status="$2" error="$3" count="$4"
  local entry
  entry=$(printf '{"name":"%s","status":"%s"' "$name" "$status")
  [ -n "$error" ] && entry="$entry,\\"error\\":\\"$error\\""
  [ -n "$count" ] && entry="$entry,\\"count\\":$count"
  entry="$entry}"
  if [ "$COLLECTORS" = "[]" ]; then
    COLLECTORS="[$entry]"
  else
    COLLECTORS="${"${"}COLLECTORS%]},$entry]"
  fi
}

# ── Ports (ss or netstat) ──
PORTS="[]"
if command -v ss >/dev/null 2>&1; then
  PORTS_RAW=$(ss -tlnp 2>/dev/null | tail -n +2)
  PORTS_UDP_RAW=$(ss -ulnp 2>/dev/null | tail -n +2)
  PORT_COUNT=0

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local_addr=$(echo "$line" | awk '{print $4}')
    port=$(echo "$local_addr" | rev | cut -d: -f1 | rev)
    addr=$(echo "$local_addr" | rev | cut -d: -f2- | rev)
    [ "$addr" = "*" ] && addr="0.0.0.0"
    proc=$(echo "$line" | grep -oP 'users:\\(\\("\\K[^"]+' 2>/dev/null || echo "")
    pid=$(echo "$line" | grep -oP 'pid=\\K[0-9]+' 2>/dev/null | head -1 || echo "")

    entry=$(printf '{"port":%s,"protocol":"tcp","address":"%s"' "$port" "$addr")
    [ -n "$proc" ] && entry="$entry,\\"process\\":\\"$proc\\""
    [ -n "$pid" ] && entry="$entry,\\"pid\\":$pid"
    entry="$entry}"

    if [ "$PORTS" = "[]" ]; then
      PORTS="[$entry]"
    else
      PORTS="${"${"}PORTS%]},$entry]"
    fi
    PORT_COUNT=$((PORT_COUNT + 1))
  done <<< "$PORTS_RAW"

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local_addr=$(echo "$line" | awk '{print $4}')
    port=$(echo "$local_addr" | rev | cut -d: -f1 | rev)
    addr=$(echo "$local_addr" | rev | cut -d: -f2- | rev)
    [ "$addr" = "*" ] && addr="0.0.0.0"

    entry=$(printf '{"port":%s,"protocol":"udp","address":"%s"}' "$port" "$addr")
    if [ "$PORTS" = "[]" ]; then
      PORTS="[$entry]"
    else
      PORTS="${"${"}PORTS%]},$entry]"
    fi
    PORT_COUNT=$((PORT_COUNT + 1))
  done <<< "$PORTS_UDP_RAW"

  add_collector "ports" "ok" "" "$PORT_COUNT"
else
  add_collector "ports" "failed" "ss not found"
fi

# ── Realms ──
REALMS="[]"

# Docker
if command -v docker >/dev/null 2>&1; then
  DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "")
  if [ -n "$DOCKER_VERSION" ]; then
    REALMS='[{"type":"docker-engine","version":"'"$DOCKER_VERSION"'","status":"running"}]'
    add_collector "docker" "ok" ""
  else
    add_collector "docker" "failed" "docker daemon not reachable"
  fi
else
  add_collector "docker" "skipped" "docker not installed"
fi

# systemd
if command -v systemctl >/dev/null 2>&1; then
  SYSTEMD_VERSION=$(systemctl --version 2>/dev/null | head -1 | awk '{print $2}' || echo "")
  entry='{"type":"systemd","version":"'"$SYSTEMD_VERSION"'","status":"running"}'
  if [ "$REALMS" = "[]" ]; then
    REALMS="[$entry]"
  else
    REALMS="${"${"}REALMS%]},$entry]"
  fi
  add_collector "systemd" "ok" ""
else
  add_collector "systemd" "skipped" "systemctl not found"
fi

# ── Compose Projects ──
COMPOSE_PROJECTS="[]"
SERVICES="[]"
SVC_COUNT=0

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_JSON=$(docker compose ls --format json 2>/dev/null || echo "[]")

  # Parse each project
  echo "$COMPOSE_JSON" | while IFS= read -r proj_line; do
    [ -z "$proj_line" ] && continue
    # docker compose ls outputs one JSON array
    true
  done

  # Use python3 if available for proper JSON parsing (data piped via stdin to avoid injection)
  if command -v python3 >/dev/null 2>&1; then
    RESULT=$(echo "$COMPOSE_JSON" | python3 -c "
import json, subprocess, sys

try:
    projects = json.load(sys.stdin)
    if not isinstance(projects, list): projects = []
except:
    projects = []

compose_projects = []
services = []

for p in projects:
    name = p.get('Name', '')
    status = p.get('Status', '')

    # Get containers for this project
    try:
        ps_out = subprocess.check_output(
            ['docker', 'compose', '-p', name, 'ps', '--format', 'json'],
            stderr=subprocess.DEVNULL, timeout=10
        ).decode()
        containers = []
        for line in ps_out.strip().splitlines():
            if not line.strip(): continue
            try:
                c = json.loads(line)
                svc_name = c.get('Service', c.get('Name', ''))
                svc_status = c.get('State', 'unknown')
                # Parse ports — prefer Publishers (structured) over Ports (string)
                publishers = c.get('Publishers', [])
                ports_str = c.get('Ports', '')
                port_nums = []
                if isinstance(publishers, list) and publishers:
                    for pp in publishers:
                        pub = pp.get('PublishedPort', 0)
                        if pub > 0: port_nums.append(pub)
                        target = pp.get('TargetPort', 0)
                        if target > 0: port_nums.append(target)
                elif isinstance(ports_str, str) and ports_str:
                    import re
                    for m in re.finditer(r'(?::)(\\d+)->', ports_str):
                        port_nums.append(int(m.group(1)))

                containers.append(svc_name)
                services.append({
                    'name': svc_name,
                    'displayName': svc_name,
                    'realmType': 'docker-compose',
                    'status': svc_status,
                    'ports': sorted(set(port_nums)),
                    'image': c.get('Image', ''),
                    'composeProject': name,
                })
            except: pass
    except: containers = []

    compose_projects.append({
        'name': name,
        'status': status,
        'services': containers,
    })

print(json.dumps({'projects': compose_projects, 'services': services}))
" 2>/dev/null)

    if [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then
      COMPOSE_PROJECTS=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['projects']))" 2>/dev/null || echo "[]")
      COMPOSE_SERVICES=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['services']))" 2>/dev/null || echo "[]")
      SERVICES="$COMPOSE_SERVICES"
      SVC_COUNT=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['services']))" 2>/dev/null || echo "0")
    fi
  fi
fi

# ── systemd services with ports ──
if command -v systemctl >/dev/null 2>&1; then
  SYSTEMD_UNITS=$(systemctl list-units --type=service --state=running --plain --no-pager --no-legend 2>/dev/null | awk '{print $1}')
  SYSTEMD_COUNT=0

  if command -v python3 >/dev/null 2>&1; then
    SYSTEMD_SVCS=$(echo "$SYSTEMD_UNITS" | python3 -c "
import json, subprocess, sys

units = sys.stdin.read().strip().splitlines()
services = []
for unit in units:
    unit = unit.strip()
    if not unit: continue
    name = unit.replace('.service', '')
    # Get PID
    try:
        pid_out = subprocess.check_output(
            ['systemctl', 'show', unit, '--property=MainPID', '--value'],
            stderr=subprocess.DEVNULL, timeout=5
        ).decode().strip()
        pid = int(pid_out) if pid_out and pid_out != '0' else None
    except:
        pid = None

    # Find ports this PID listens on
    ports = []
    if pid:
        try:
            ss_out = subprocess.check_output(
                ['ss', '-tlnp'],
                stderr=subprocess.DEVNULL, timeout=5
            ).decode()
            for line in ss_out.splitlines():
                if 'pid=%d,' % pid in line or 'pid=%d}' % pid in line:
                    parts = line.split()
                    if len(parts) >= 4:
                        addr = parts[3]
                        port = addr.rsplit(':', 1)[-1]
                        try: ports.append(int(port))
                        except: pass
        except: pass

    if ports:
        services.append({
            'name': name,
            'displayName': name,
            'realmType': 'systemd',
            'status': 'running',
            'ports': sorted(set(ports)),
            'pid': pid,
        })

print(json.dumps(services))
" 2>/dev/null || echo "[]")

    if [ -n "$SYSTEMD_SVCS" ] && [ "$SYSTEMD_SVCS" != "[]" ]; then
      # Merge with SERVICES — pipe both arrays via stdin
      if [ "$SERVICES" = "[]" ]; then
        SERVICES="$SYSTEMD_SVCS"
      else
        SERVICES=$(printf '%s\n%s' "$SERVICES" "$SYSTEMD_SVCS" | python3 -c "
import json, sys
lines = sys.stdin.read().strip().splitlines()
a = json.loads(lines[0])
b = json.loads(lines[1])
print(json.dumps(a + b))
" 2>/dev/null || echo "$SERVICES")
      fi
      SYSTEMD_COUNT=$(echo "$SYSTEMD_SVCS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
      SVC_COUNT=$((SVC_COUNT + SYSTEMD_COUNT))
    fi
  fi
fi

# ── Emit final JSON ──
cat <<ENDJSON
{
  "scannedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "os": "linux",
  "arch": "$ARCH_JSON",
  "hostname": "$HOSTNAME_VAL",
  "realms": $REALMS,
  "services": $SERVICES,
  "ports": $PORTS,
  "composeProjects": $COMPOSE_PROJECTS,
  "collectors": $COLLECTORS
}
ENDJSON
`
