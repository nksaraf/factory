import { existsSync, statfsSync } from "node:fs";
import { platform, arch } from "node:os";
import { run } from "../../lib/subprocess.js";
import type { InstallRole } from "@smp/factory-shared/install-types";
import type { PreflightCheck, PreflightResult } from "@smp/factory-shared/install-types";

const REQUIRED_PORTS = [6443, 443, 80, 10250];
const MIN_DISK_GB_SITE = 20;
const MIN_DISK_GB_FACTORY = 50;

function check(name: string, passed: boolean, message: string, required = true): PreflightCheck {
  return { name, passed, message, required };
}

function checkRoot(): PreflightCheck {
  const isRoot = process.getuid?.() === 0;
  return check("root", isRoot, isRoot ? "Running as root" : "Must run as root (use sudo)");
}

function checkOs(): PreflightCheck {
  const os = platform();
  const ok = os === "linux";
  return check(
    "os",
    ok,
    ok ? `OS: ${os}` : `Unsupported OS: ${os} (linux required)`,
    true
  );
}

function checkArch(): PreflightCheck {
  const a = arch();
  const ok = a === "x64" || a === "arm64";
  return check("arch", ok, ok ? `Arch: ${a}` : `Unsupported arch: ${a} (x64 or arm64 required)`);
}

function checkDisk(role: InstallRole): PreflightCheck {
  const minGb = role === "factory" ? MIN_DISK_GB_FACTORY : MIN_DISK_GB_SITE;
  try {
    const stats = statfsSync("/");
    const freeGb = Math.floor((stats.bfree * stats.bsize) / (1024 * 1024 * 1024));
    const ok = freeGb >= minGb;
    return check(
      "disk",
      ok,
      ok ? `Free disk: ${freeGb}GB (need ${minGb}GB)` : `Insufficient disk: ${freeGb}GB (need ${minGb}GB)`
    );
  } catch {
    return check("disk", false, "Could not check disk space");
  }
}

function checkPort(port: number): PreflightCheck {
  const result = run("ss", ["-tlnp", `sport = :${port}`]);
  const inUse = result.status === 0 && result.stdout.includes(`:${port}`);
  return check(
    `port-${port}`,
    !inUse,
    inUse ? `Port ${port} is in use` : `Port ${port} is available`
  );
}

function checkNoExistingK3s(force: boolean): PreflightCheck {
  const exists = existsSync("/usr/local/bin/k3s") || existsSync("/etc/rancher/k3s");
  if (force && exists) {
    return check("no-existing-k3s", true, "Existing k3s found (--force specified)", false);
  }
  return check(
    "no-existing-k3s",
    !exists,
    exists ? "k3s already installed (use --force to override)" : "No existing k3s installation"
  );
}

function checkDns(domain: string): PreflightCheck {
  const result = run("getent", ["hosts", domain]);
  const ok = result.status === 0;
  return check(
    "dns",
    ok,
    ok ? `DNS resolves: ${domain}` : `DNS does not resolve: ${domain}`,
    false
  );
}

export function runPreflight(opts: {
  role: InstallRole;
  domain?: string;
  installMode?: string;
  force?: boolean;
}): PreflightResult {
  const checks: PreflightCheck[] = [
    checkRoot(),
    checkOs(),
    checkArch(),
    checkDisk(opts.role),
    ...REQUIRED_PORTS.map(checkPort),
    checkNoExistingK3s(opts.force ?? false),
  ];

  if (opts.installMode !== "offline" && opts.domain) {
    checks.push(checkDns(opts.domain));
  }

  const passed = checks.filter((c) => c.required).every((c) => c.passed);
  return { passed, checks, role: opts.role };
}
