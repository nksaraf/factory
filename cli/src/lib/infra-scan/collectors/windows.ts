/**
 * Windows infrastructure collector.
 * Generates a PowerShell script that outputs JSON to stdout.
 */

/**
 * PowerShell script that collects infrastructure data on a Windows host.
 * Outputs a single JSON object to stdout.
 */
// Using string concatenation to avoid JS template literal parsing of PowerShell ${ } syntax
/* eslint-disable prefer-template */
export const WINDOWS_COLLECTOR_SCRIPT =
  "$ErrorActionPreference = 'SilentlyContinue'\n" +
  "\n" +
  "$hostname = $env:COMPUTERNAME\n" +
  '$arch = if ([System.Environment]::Is64BitOperatingSystem) { "amd64" } else { "x86" }\n' +
  '$scannedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")\n' +
  "\n" +
  "$collectors = @()\n" +
  "$runtimes = @()\n" +
  "$services = @()\n" +
  "$ports = @()\n" +
  "$composeProjects = @()\n" +
  "\n" +
  "# -- Ports --\n" +
  "try {\n" +
  "    $tcpConns = Get-NetTCPConnection -State Listen 2>$null\n" +
  "    foreach ($conn in $tcpConns) {\n" +
  '        $procName = ""\n' +
  "        try {\n" +
  "            $proc = Get-Process -Id $conn.OwningProcess 2>$null\n" +
  "            $procName = $proc.ProcessName\n" +
  "        } catch {}\n" +
  "\n" +
  "        $ports += @{\n" +
  "            port = $conn.LocalPort\n" +
  '            protocol = "tcp"\n' +
  '            address = if ($conn.LocalAddress -eq "0.0.0.0" -or $conn.LocalAddress -eq "::") { "0.0.0.0" } else { $conn.LocalAddress }\n' +
  "            process = $procName\n" +
  "            pid = $conn.OwningProcess\n" +
  "        }\n" +
  "    }\n" +
  "    $collectors += @{ name = 'ports'; status = 'ok'; count = $ports.Count }\n" +
  "} catch {\n" +
  "    $collectors += @{ name = 'ports'; status = 'failed'; error = $_.Exception.Message }\n" +
  "}\n" +
  "\n" +
  "# -- Docker --\n" +
  "try {\n" +
  "    $dockerVersion = & docker version --format '{{.Server.Version}}' 2>$null\n" +
  "    if ($LASTEXITCODE -eq 0 -and $dockerVersion) {\n" +
  "        $runtimes += @{ type = 'docker-engine'; version = $dockerVersion; status = 'running' }\n" +
  "\n" +
  "        # Compose projects\n" +
  "        try {\n" +
  "            $composeRaw = & docker compose ls --format json 2>$null\n" +
  "            if ($LASTEXITCODE -eq 0 -and $composeRaw) {\n" +
  "                $projects = $composeRaw | ConvertFrom-Json\n" +
  "                foreach ($proj in $projects) {\n" +
  "                    $projName = $proj.Name\n" +
  "                    $projServices = @()\n" +
  "                    try {\n" +
  "                        $psRaw = & docker compose -p $projName ps --format json 2>$null\n" +
  '                        foreach ($line in ($psRaw -split "`n")) {\n' +
  "                            if (-not $line.Trim()) { continue }\n" +
  "                            $c = $line | ConvertFrom-Json\n" +
  "                            $svcName = if ($c.Service) { $c.Service } else { $c.Name }\n" +
  "                            $svcPorts = @()\n" +
  "                            if ($c.Publishers) {\n" +
  "                                foreach ($pub in $c.Publishers) {\n" +
  "                                    if ($pub.PublishedPort -gt 0) { $svcPorts += $pub.PublishedPort }\n" +
  "                                }\n" +
  "                            }\n" +
  "                            $projServices += $svcName\n" +
  "                            $services += @{\n" +
  "                                name = $svcName\n" +
  "                                displayName = $svcName\n" +
  "                                runtime = 'docker'\n" +
  "                                status = if ($c.State) { $c.State } else { 'unknown' }\n" +
  "                                ports = @($svcPorts | Sort-Object -Unique)\n" +
  "                                image = $c.Image\n" +
  "                                composeProject = $projName\n" +
  "                            }\n" +
  "                        }\n" +
  "                    } catch {}\n" +
  "                    $composeProjects += @{\n" +
  "                        name = $projName\n" +
  "                        status = $proj.Status\n" +
  "                        services = @($projServices)\n" +
  "                    }\n" +
  "                }\n" +
  "            }\n" +
  "        } catch {}\n" +
  "        $collectors += @{ name = 'docker'; status = 'ok' }\n" +
  "    } else {\n" +
  "        $collectors += @{ name = 'docker'; status = 'failed'; error = 'docker daemon not reachable' }\n" +
  "    }\n" +
  "} catch {\n" +
  "    $collectors += @{ name = 'docker'; status = 'skipped'; error = 'docker not installed' }\n" +
  "}\n" +
  "\n" +
  "# -- IIS --\n" +
  "try {\n" +
  "    Import-Module WebAdministration -ErrorAction Stop\n" +
  "    $iisSites = Get-IISSite 2>$null\n" +
  "    if (-not $iisSites) { $iisSites = Get-WebSite 2>$null }\n" +
  "\n" +
  "    if ($iisSites) {\n" +
  "        $iisVersion = (Get-ItemProperty HKLM:\\\\SOFTWARE\\\\Microsoft\\\\InetStp).VersionString 2>$null\n" +
  "        $runtimes += @{ type = 'iis'; version = $iisVersion; status = 'running' }\n" +
  "\n" +
  "        foreach ($site in $iisSites) {\n" +
  "            $sitePorts = @()\n" +
  "            $bindings = $site.Bindings\n" +
  "            if ($bindings.Collection) {\n" +
  "                foreach ($b in $bindings.Collection) {\n" +
  "                    $bindInfo = $b.bindingInformation\n" +
  "                    if ($bindInfo -match ':(\\d+):') { $sitePorts += [int]$Matches[1] }\n" +
  "                }\n" +
  "            }\n" +
  "            $services += @{\n" +
  "                name = $site.Name\n" +
  "                displayName = $site.Name\n" +
  "                runtime = 'iis'\n" +
  '                status = if ($site.State -eq "Started") { "running" } else { "stopped" }\n' +
  "                ports = @($sitePorts | Sort-Object -Unique)\n" +
  "                metadata = @{\n" +
  "                    physicalPath = $site.PhysicalPath\n" +
  "                    appPool = $site.ApplicationPool\n" +
  "                }\n" +
  "            }\n" +
  "        }\n" +
  "        $collectors += @{ name = 'iis'; status = 'ok'; count = $iisSites.Count }\n" +
  "    } else {\n" +
  "        $collectors += @{ name = 'iis'; status = 'skipped'; error = 'no IIS sites found' }\n" +
  "    }\n" +
  "} catch {\n" +
  "    $collectors += @{ name = 'iis'; status = 'skipped'; error = 'IIS module not available' }\n" +
  "}\n" +
  "\n" +
  "# -- Windows Services --\n" +
  "try {\n" +
  "    $winServices = Get-Service | Where-Object { $_.Status -eq 'Running' -and $_.ServiceType -ne 'KernelDriver' -and $_.ServiceType -ne 'FileSystemDriver' }\n" +
  "\n" +
  "    # Build a PID-to-ports lookup from our existing port scan\n" +
  "    $pidPorts = @{}\n" +
  "    foreach ($p in $ports) {\n" +
  "        $key = [string]$p.pid\n" +
  "        if (-not $pidPorts.ContainsKey($key)) { $pidPorts[$key] = @() }\n" +
  "        $pidPorts[$key] += $p.port\n" +
  "    }\n" +
  "\n" +
  "    $runtimes += @{ type = 'windows-service'; status = 'running' }\n" +
  "\n" +
  "    foreach ($svc in $winServices) {\n" +
  "        try {\n" +
  "            $wmiSvc = Get-CimInstance Win32_Service -Filter \"Name='$($svc.Name)'\" 2>$null\n" +
  "            $svcPid = if ($wmiSvc) { $wmiSvc.ProcessId } else { 0 }\n" +
  "            $svcPorts = @()\n" +
  "            if ($svcPid -gt 0 -and $pidPorts.ContainsKey([string]$svcPid)) {\n" +
  "                $svcPorts = $pidPorts[[string]$svcPid]\n" +
  "            }\n" +
  "            # Only include services that have listening ports (skip background noise)\n" +
  "            if ($svcPorts.Count -gt 0) {\n" +
  "                $cmdLine = ''\n" +
  "                if ($wmiSvc) { $cmdLine = $wmiSvc.PathName }\n" +
  "                $services += @{\n" +
  "                    name = $svc.Name\n" +
  "                    displayName = $svc.DisplayName\n" +
  "                    runtime = 'windows-service'\n" +
  "                    status = 'running'\n" +
  "                    ports = @($svcPorts | Sort-Object -Unique)\n" +
  "                    pid = $svcPid\n" +
  "                    command = $cmdLine\n" +
  "                }\n" +
  "            }\n" +
  "        } catch {}\n" +
  "    }\n" +
  "    $winsvcCount = ($services | Where-Object { $_.runtime -eq 'windows-service' }).Count\n" +
  "    $collectors += @{ name = 'windows-service'; status = 'ok'; count = $winsvcCount }\n" +
  "} catch {\n" +
  "    $collectors += @{ name = 'windows-service'; status = 'failed'; error = $_.Exception.Message }\n" +
  "}\n" +
  "\n" +
  "# -- Emit JSON --\n" +
  "$result = @{\n" +
  "    scannedAt = $scannedAt\n" +
  "    os = 'windows'\n" +
  "    arch = $arch\n" +
  "    hostname = $hostname\n" +
  "    runtimes = @($runtimes)\n" +
  "    services = @($services)\n" +
  "    ports = @($ports)\n" +
  "    composeProjects = @($composeProjects)\n" +
  "    collectors = @($collectors)\n" +
  "}\n" +
  "\n" +
  "$result | ConvertTo-Json -Depth 10 -Compress\n"
