import { existsSync, statfsSync } from "node:fs";
import { platform, arch } from "node:os";
import { run } from "../../lib/subprocess.js";
import type { InstallRole } from "@smp/factory-shared/install-types";
import type { PreflightCheck, PreflightResult } from "@smp/factory-shared/install-types";

const REQUIRED_PORTS = [6443, 443, 80, 10250];
const MIN_DISK_GB: Record<InstallRole, number> = {
  workbench: 2,
  site: 20,
  factory: 50,
};

function check(name: string, passed: boolean, message: string, required = true): PreflightCheck {
  return { name, passed, message, required };
}

function checkRoot(): PreflightCheck {
  const isRoot = process.getuid?.() === 0;
  return check("root", isRoot, isRoot ? "root" : "not root (use sudo)");
}

function checkOs(role: InstallRole): PreflightCheck {
  const os = platform();
  if (role === "workbench") {
    return check("os", true, `${os}/${arch()}`, false);
  }
  const ok = os === "linux";
  return check("os", ok, ok ? `linux/${arch()}` : `${os} (linux required)`);
}

function checkArch(): PreflightCheck {
  const a = arch();
  const ok = a === "x64" || a === "arm64";
  return check("arch", ok, ok ? a : `${a} (x64/arm64 required)`);
}

function checkDisk(role: InstallRole): PreflightCheck {
  const minGb = MIN_DISK_GB[role];
  try {
    const stats = statfsSync("/");
    const freeGb = Math.floor((stats.bfree * stats.bsize) / (1024 * 1024 * 1024));
    const ok = freeGb >= minGb;
    return check("disk", ok, ok ? `disk ${freeGb}GB` : `disk ${freeGb}GB (need ${minGb}GB)`);
  } catch {
    return check("disk", false, "disk check failed");
  }
}

function checkPort(port: number): PreflightCheck {
  const result = run("ss", ["-tlnp", `sport = :${port}`]);
  const inUse = result.status === 0 && result.stdout.includes(`:${port}`);
  return check(`port-${port}`, !inUse, inUse ? `port ${port} in use` : `port ${port}`);
}

function checkNoExistingK3s(force: boolean): PreflightCheck {
  const exists = existsSync("/usr/local/bin/k3s") || existsSync("/etc/rancher/k3s");
  if (force && exists) return check("k3s", true, "k3s found (--force)", false);
  return check("k3s", !exists, exists ? "k3s exists (use --force)" : "no k3s");
}

function checkDns(domain: string): PreflightCheck {
  const result = run("getent", ["hosts", domain]);
  const ok = result.status === 0;
  return check("dns", ok, ok ? `dns ${domain}` : `dns fail ${domain}`, false);
}

export function runPreflight(opts: {
  role: InstallRole;
  domain?: string;
  installMode?: string;
  force?: boolean;
}): PreflightResult {
  const checks: PreflightCheck[] = [];

  // Workbench: light checks only
  if (opts.role === "workbench") {
    checks.push(checkOs(opts.role), checkArch(), checkDisk(opts.role));
    const passed = checks.filter((c) => c.required).every((c) => c.passed);
    return { passed, checks, role: opts.role };
  }

  // Site/Factory: full checks
  checks.push(
    checkRoot(),
    checkOs(opts.role),
    checkArch(),
    checkDisk(opts.role),
    ...REQUIRED_PORTS.map(checkPort),
    checkNoExistingK3s(opts.force ?? false),
  );

  if (opts.installMode !== "offline" && opts.domain) {
    checks.push(checkDns(opts.domain));
  }

  const passed = checks.filter((c) => c.required).every((c) => c.passed);
  return { passed, checks, role: opts.role };
}
