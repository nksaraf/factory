# dx install — Interactive Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crash-on-missing-config `dx install` with a rich interactive wizard that supports three roles (workbench, site, factory), uses `@crustjs/store` for config, and provides polished CLI output with spinners and progress.

**Architecture:** Single `@crustjs/store`-backed config at `~/.config/dx/config.json` replaces the hand-rolled YAML config. Interactive wizard using `@inquirer/prompts` collects minimal essential inputs (2-3 per role) with an optional advanced mode. `ora` spinners wrap each install phase. The install command branches on role: workbench runs auth+context, site/factory runs the existing 6-phase cluster install.

**Tech Stack:** `@crustjs/store`, `@inquirer/prompts`, `ora`, `@crustjs/style`, Bun, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-dx-install-interactive-setup.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `factory/shared/src/install-types.ts` | Modify | Add `"workbench"` role, `WORKBENCH_PLANES` |
| `factory/cli/package.json` | Modify | Add `@inquirer/prompts`, `ora` deps |
| `factory/cli/src/config.ts` | Rewrite | `@crustjs/store` config with `factoryUrl`/`siteUrl`, project-local overlay |
| `factory/cli/src/client.ts` | Modify | Read from new async store, add `getSiteClient()` |
| `factory/cli/src/auth-factory.ts` | Modify | Read auth config from new store |
| `factory/cli/src/lib/cli-ui.ts` | Create | Banner, phase spinner, preflight line formatting |
| `factory/cli/src/handlers/install/interactive-setup.ts` | Create | Role-driven wizard with `@inquirer/prompts` |
| `factory/cli/src/handlers/install/workbench.ts` | Create | Workbench install flow (auth, context, docker) |
| `factory/cli/src/handlers/install/preflight.ts` | Modify | Three-tier role-aware checks |
| `factory/cli/src/commands/install.ts` | Rewrite | Wire wizard, role branching, spinners, ctrl+C |
| `factory/cli/src/lib/site-config.ts` | Modify | Remove `loadSiteConfig`, keep `siteConfigToHelmValues` reading from store |
| `factory/cli/src/handlers/install/helm.ts` | Modify | Accept config from store instead of `SiteConfig` |
| `factory/cli/src/handlers/install/post-install.ts` | Modify | Read config from store, write store after manifest |

---

## Task 1: Add `"workbench"` to `InstallRole`

**Files:**
- Modify: `factory/shared/src/install-types.ts`

- [ ] **Step 1: Update InstallRole type**

```typescript
// factory/shared/src/install-types.ts

/** Installation role: workbench (developer), site (edge), or factory (control plane). */
export type InstallRole = "workbench" | "site" | "factory";
```

- [ ] **Step 2: Add WORKBENCH_PLANES and update planesForRole**

```typescript
export const WORKBENCH_PLANES = [] as const;

export function planesForRole(role: InstallRole): string[] {
  if (role === "factory") return [...FACTORY_PLANES];
  if (role === "site") return [...SITE_PLANES];
  return [...WORKBENCH_PLANES];
}
```

- [ ] **Step 3: Comment bundleManifestSchema**

Add a comment above `bundleManifestSchema` explaining the enum stays `["site", "factory"]` because bundles are cluster-only:

```typescript
/** Manifest for an offline bundle (bundle/manifest.json). Cluster-only — workbenches don't use bundles. */
export const bundleManifestSchema = z.object({
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd factory/shared && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add factory/shared/src/install-types.ts
git commit -m "feat(install): add workbench to InstallRole type"
```

---

## Task 2: Add dependencies

**Files:**
- Modify: `factory/cli/package.json`

- [ ] **Step 1: Add @inquirer/prompts and ora**

Add to `dependencies` in `factory/cli/package.json`:

```json
"@inquirer/prompts": "^7.0.0",
"ora": "^8.0.0"
```

- [ ] **Step 2: Install**

Run: `pnpm install` from repo root.

- [ ] **Step 3: Commit**

```bash
git add factory/cli/package.json pnpm-lock.yaml
git commit -m "chore(cli): add @inquirer/prompts and ora dependencies"
```

---

## Task 3: Rewrite config.ts with @crustjs/store

**Files:**
- Rewrite: `factory/cli/src/config.ts`

This is the core change. Replaces the YAML-based `loadConfig`/`saveConfig` with a typed `@crustjs/store` config store.

- [ ] **Step 1: Write the new config.ts**

```typescript
// factory/cli/src/config.ts
import path from "node:path";
import { existsSync } from "node:fs";
import { configDir, createStore } from "@crustjs/store";
import type { InstallRole } from "@smp/factory-shared/install-types";

const DX_CONFIG_DIR = configDir("dx");

/** Shared field definitions — used by both global and project-local stores. */
export const DX_CONFIG_FIELDS = {
  // Role
  role: { type: "string", default: "workbench" },

  // Connection (all roles)
  factoryUrl: { type: "string", default: "https://factory.rio.software" },
  siteUrl: { type: "string", default: "" },
  context: { type: "string", default: "" },

  // Auth
  authBasePath: { type: "string", default: "/api/v1/auth" },

  // Cluster install params (site/factory) — good defaults
  siteName: { type: "string", default: "" },
  domain: { type: "string", default: "" },
  adminEmail: { type: "string", default: "" },
  tlsMode: { type: "string", default: "self-signed" },
  tlsCertPath: { type: "string", default: "" },
  tlsKeyPath: { type: "string", default: "" },
  databaseMode: { type: "string", default: "embedded" },
  databaseUrl: { type: "string", default: "" },
  registryMode: { type: "string", default: "embedded" },
  registryUrl: { type: "string", default: "" },
  resourceProfile: { type: "string", default: "small" },
  networkPodCidr: { type: "string", default: "10.42.0.0/16" },
  networkServiceCidr: { type: "string", default: "10.43.0.0/16" },
  installMode: { type: "string", default: "connected" },
} as const;

/**
 * Global DX config store at ~/.config/dx/config.json.
 * Written by `dx install`, read by all CLI commands.
 */
export const dxConfigStore = createStore({
  dirPath: DX_CONFIG_DIR,
  name: "config",
  fields: DX_CONFIG_FIELDS,
});

/** Type of the resolved config object. */
export type DxConfig = Awaited<ReturnType<typeof dxConfigStore.read>>;

/** Resolved path to the global config file. */
export function configPath(): string {
  return path.join(DX_CONFIG_DIR, "config.json");
}

/** Check if global config exists on disk. */
export function configExists(): boolean {
  return existsSync(configPath());
}

/**
 * Try to find a project-local .dx/config.json by walking up from cwd.
 * Returns the dirPath if found, undefined otherwise.
 */
function findProjectConfigDir(): string | undefined {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, ".dx");
    if (existsSync(path.join(candidate, "config.json"))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Read merged config: project-local .dx/config.json > global > defaults.
 */
export async function readConfig(): Promise<DxConfig> {
  const global = await dxConfigStore.read();
  const localDir = findProjectConfigDir();
  if (!localDir) return global;

  const localStore = createStore({
    dirPath: localDir,
    name: "config",
    fields: DX_CONFIG_FIELDS,
  });
  const local = await localStore.read();

  // Merge: local non-empty values override global
  const merged = { ...global };
  for (const [key, val] of Object.entries(local)) {
    if (typeof val === "string" && val.length > 0) {
      (merged as Record<string, string>)[key] = val;
    }
  }
  return merged;
}

/** Resolve the factory API URL from config. */
export function resolveFactoryUrl(config: DxConfig): string {
  return config.factoryUrl.replace(/\/$/, "");
}

/** Resolve the site API URL from config. Returns empty string if not set. */
export function resolveSiteUrl(config: DxConfig): string {
  return config.siteUrl.replace(/\/$/, "");
}

// --- Legacy compatibility ---
// These match the old DxConfig interface shape for callers that haven't migrated yet.

export interface LegacyDxConfig {
  apiUrl: string;
  authUrl: string;
  authBasePath: string;
  token?: string;
  defaultSite?: string;
  mode?: "factory" | "site" | "dev";
  siteUrl?: string;
}

/**
 * @deprecated Use readConfig() instead. This is a sync shim for callers
 * that haven't been migrated to async yet.
 */
export function loadConfig(): LegacyDxConfig {
  // Sync fallback: read the JSON file directly (no store)
  const file = configPath();
  let parsed: Record<string, string> = {};
  try {
    const raw = require("node:fs").readFileSync(file, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    // No config file — use defaults
  }
  const factoryUrl = (parsed.factoryUrl || "https://factory.rio.software").replace(/\/$/, "");
  const role = parsed.role || "workbench";
  return {
    apiUrl: factoryUrl,
    authUrl: factoryUrl,
    authBasePath: parsed.authBasePath || "/api/v1/auth",
    token: undefined,
    defaultSite: parsed.siteName || undefined,
    mode: role === "factory" ? "factory" : role === "site" ? "site" : "dev",
    siteUrl: parsed.siteUrl || undefined,
  };
}

/** @deprecated Use dxConfigStore.write() instead. */
export function saveConfig(_config: LegacyDxConfig): void {
  // No-op during migration. New code uses dxConfigStore.write().
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd factory/cli && npx tsc --noEmit`

There will likely be type errors in files that import the old `DxConfig` type — that's expected. The `loadConfig()` shim preserves the old interface so most callers keep working. Fix any import issues.

- [ ] **Step 3: Commit**

```bash
git add factory/cli/src/config.ts
git commit -m "feat(cli): rewrite config.ts with @crustjs/store backend"
```

---

## Task 4: Update client.ts

**Files:**
- Modify: `factory/cli/src/client.ts`

- [ ] **Step 1: Update getFactoryClient to use new config**

```typescript
// factory/cli/src/client.ts
import { type Treaty, treaty } from "@elysiajs/eden"
import type { FactoryApp } from "@smp/factory-api/app-type"

import { readConfig, resolveFactoryUrl } from "./config.js"
import { getStoredBearerToken } from "./session-token.js"

export type FactoryEdenClient = Treaty.Create<FactoryApp>

/**
 * Typed Eden client for the Factory API.
 */
export async function getFactoryClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<Treaty.Create<FactoryApp>> {
  const cfg = await readConfig()
  const url = (baseUrl ?? resolveFactoryUrl(cfg)).replace(/\/$/, "")
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored

  return treaty<FactoryApp>(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

/**
 * Typed Eden client for the local Site API.
 * Returns undefined if no siteUrl is configured.
 */
export async function getSiteClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<Treaty.Create<FactoryApp> | undefined> {
  const cfg = await readConfig()
  const siteUrl = baseUrl ?? cfg.siteUrl
  if (!siteUrl) return undefined

  const url = siteUrl.replace(/\/$/, "")
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored

  return treaty<FactoryApp>(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add factory/cli/src/client.ts
git commit -m "feat(cli): update client.ts to read from @crustjs/store config"
```

---

## Task 5: Update auth-factory.ts

**Files:**
- Modify: `factory/cli/src/auth-factory.ts`

- [ ] **Step 1: Read auth-factory.ts**

Read the current file to understand the auth client creation pattern.

- [ ] **Step 2: Update to use new config, make flags optional**

```typescript
// factory/cli/src/auth-factory.ts
import { createCliAuthClient } from "@rio.js/auth-client/node";

import { readConfig, resolveFactoryUrl } from "./config.js";
import { readSession, writeSession } from "./session-token.js";
import type { DxFlags } from "./stub.js";

export async function createFactoryAuthClient(flags?: Partial<DxFlags>) {
  const cfg = await readConfig();
  const baseURL = resolveFactoryUrl(cfg);

  return createCliAuthClient({
    baseURL,
    basePath: cfg.authBasePath,
    debug: flags?.debug,
    storage: {
      getBearerToken: async () => (await readSession()).bearerToken ?? null,
      setBearerToken: async (token: string) => {
        await writeSession({ bearerToken: token });
      },
      getJwt: async () => (await readSession()).jwt ?? null,
      setJwt: async (jwt: string) => {
        await writeSession({ jwt });
      },
    },
  });
}
```

Key changes: `flags` parameter is now optional (`Partial<DxFlags>`), function is `async`, uses `readConfig()` + `resolveFactoryUrl()`.

- [ ] **Step 3: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add factory/cli/src/auth-factory.ts
git commit -m "refactor(cli): update auth-factory to use new config store"
```

---

## Task 6: Create cli-ui.ts

**Files:**
- Create: `factory/cli/src/lib/cli-ui.ts`

- [ ] **Step 1: Write cli-ui.ts**

```typescript
// factory/cli/src/lib/cli-ui.ts
import ora, { type Ora } from "ora";
import { styleSuccess, styleError, styleWarn, styleMuted } from "../cli-style.js";

/**
 * Print the dx install welcome banner.
 */
export function banner(version: string): void {
  console.log(`\n  dx platform installer v${version}\n`);
}

/**
 * Format a single preflight check result for one-line output.
 */
export function preflightMark(name: string, passed: boolean, required: boolean): string {
  if (passed) return styleSuccess(`✔ ${name}`);
  if (required) return styleError(`✖ ${name}`);
  return styleWarn(`⚠ ${name}`);
}

/**
 * Print preflight results as a single compact line.
 */
export function printPreflightLine(checks: Array<{ name: string; passed: boolean; message: string; required: boolean }>): void {
  const marks = checks.map((c) => preflightMark(c.message, c.passed, c.required));
  console.log(`  ${marks.join("  ")}`);
}

/**
 * Create a phase spinner: [n/total] label...
 * Returns the ora instance for .succeed() / .fail().
 */
export function phase(n: number, total: number, label: string): Ora {
  return ora({
    text: `[${n}/${total}] ${label}`,
    prefixText: " ",
    spinner: "dots",
  }).start();
}

/**
 * Mark a phase spinner as succeeded with elapsed time.
 */
export function phaseSucceed(spinner: Ora, n: number, total: number, label: string, startMs: number): void {
  const elapsed = formatElapsed(Date.now() - startMs);
  spinner.succeed(`[${n}/${total}] ${label} ${styleMuted(elapsed)}`);
}

/**
 * Mark a phase spinner as failed.
 */
export function phaseFail(spinner: Ora, n: number, total: number, label: string, error: string): void {
  spinner.fail(`[${n}/${total}] ${label} — ${error}`);
}

/**
 * Format milliseconds as human-readable elapsed time.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remainder = s % 60;
  return `${m}m ${Math.round(remainder)}s`;
}

/**
 * Print the final success line.
 */
export function successLine(message: string, totalMs: number): void {
  console.log(`\n  ${styleSuccess("✔")} ${message} ${styleMuted(`(${formatElapsed(totalMs)})`)}`);
}

/**
 * Print indented info lines (for "next steps" etc).
 */
export function infoLine(text: string): void {
  console.log(`    ${text}`);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add factory/cli/src/lib/cli-ui.ts
git commit -m "feat(cli): add cli-ui utilities for banner, spinners, preflight output"
```

---

## Task 7: Update preflight.ts for three-tier checks

**Files:**
- Modify: `factory/cli/src/handlers/install/preflight.ts`

- [ ] **Step 1: Update preflight to be role-aware**

Replace the existing `runPreflight` with three-tier logic:

```typescript
// factory/cli/src/handlers/install/preflight.ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add factory/cli/src/handlers/install/preflight.ts
git commit -m "feat(cli): three-tier role-aware preflight checks"
```

---

## Task 8: Create interactive-setup.ts

**Files:**
- Create: `factory/cli/src/handlers/install/interactive-setup.ts`

- [ ] **Step 1: Write the wizard**

```typescript
// factory/cli/src/handlers/install/interactive-setup.ts
import { select, input } from "@inquirer/prompts";
import type { InstallRole } from "@smp/factory-shared/install-types";
import type { DxConfig } from "../../config.js";

export interface WizardResult {
  role: InstallRole;
  factoryUrl: string;
  siteUrl: string;
  siteName: string;
  domain: string;
  adminEmail: string;
  // Advanced options
  tlsMode: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  databaseMode: string;
  databaseUrl: string;
  registryMode: string;
  registryUrl: string;
  resourceProfile: string;
}

/**
 * Interactive install wizard. Prompts for essential config,
 * with optional advanced mode for TLS/database/resources.
 */
export async function runWizard(defaults: DxConfig): Promise<WizardResult> {
  const role = await select<InstallRole>({
    message: "Role",
    choices: [
      { value: "workbench", name: "Workbench (developer / agent)" },
      { value: "site", name: "Site (edge deployment)" },
      { value: "factory", name: "Factory (control plane)" },
    ],
    default: "workbench",
  });

  if (role === "workbench") {
    const factoryUrl = await input({
      message: "Factory URL",
      default: defaults.factoryUrl || "https://factory.rio.software",
      validate: (v) => v.length > 0 || "Required",
    });

    return {
      role,
      factoryUrl,
      siteUrl: "",
      siteName: "",
      domain: "",
      adminEmail: "",
      tlsMode: "self-signed",
      tlsCertPath: "",
      tlsKeyPath: "",
      databaseMode: "embedded",
      databaseUrl: "",
      registryMode: "embedded",
      registryUrl: "",
      resourceProfile: "small",
    };
  }

  // Site or Factory — cluster install
  const siteName = role === "factory"
    ? "factory"
    : await input({
        message: "Site name",
        validate: (v) => /^[a-z0-9][a-z0-9-]*$/.test(v) || "Lowercase alphanumeric with hyphens",
      });

  const domain = await input({
    message: "Domain",
    default: role === "factory" ? "factory.rio.software" : "",
    validate: (v) => v.length > 0 || "Required",
  });

  const adminEmail = await input({
    message: "Admin email",
    default: defaults.adminEmail || "",
    validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Valid email required",
  });

  // Factory URL
  let factoryUrl: string;
  if (role === "factory") {
    factoryUrl = `https://${domain}`;
  } else {
    factoryUrl = await input({
      message: "Factory URL",
      default: defaults.factoryUrl || "https://factory.rio.software",
      validate: (v) => v.length > 0 || "Required",
    });
  }

  // Advanced options gate
  let tlsMode = "self-signed";
  let tlsCertPath = "";
  let tlsKeyPath = "";
  let databaseMode = "embedded";
  let databaseUrl = "";
  let registryMode = "embedded";
  let registryUrl = "";
  let resourceProfile = role === "factory" ? "medium" : "small";

  const customize = await select({
    message: "Advanced (TLS, database, resources)",
    choices: [
      { value: false, name: "Use defaults" },
      { value: true, name: "Customize" },
    ],
    default: false,
  });

  if (customize) {
    tlsMode = await select({
      message: "TLS",
      choices: [
        { value: "self-signed", name: "Self-signed" },
        { value: "letsencrypt", name: "Let's Encrypt" },
        { value: "provided", name: "Provided (bring your own cert)" },
      ],
      default: "self-signed",
    });

    if (tlsMode === "provided") {
      tlsCertPath = await input({ message: "TLS cert path", validate: (v) => v.length > 0 || "Required" });
      tlsKeyPath = await input({ message: "TLS key path", validate: (v) => v.length > 0 || "Required" });
    }

    databaseMode = await select({
      message: "Database",
      choices: [
        { value: "embedded", name: "Embedded" },
        { value: "external", name: "External" },
      ],
      default: "embedded",
    });

    if (databaseMode === "external") {
      databaseUrl = await input({ message: "Database URL", validate: (v) => v.length > 0 || "Required" });
    }

    resourceProfile = await select({
      message: "Resources",
      choices: [
        { value: "small", name: "Small (dev/testing)" },
        { value: "medium", name: "Medium (production)" },
        { value: "large", name: "Large (high traffic)" },
      ],
      default: resourceProfile,
    });

    registryMode = await select({
      message: "Registry",
      choices: [
        { value: "embedded", name: "Embedded" },
        { value: "external", name: "External" },
      ],
      default: "embedded",
    });

    if (registryMode === "external") {
      registryUrl = await input({ message: "Registry URL" });
    }
  }

  return {
    role,
    factoryUrl,
    siteUrl: `https://${domain}`,
    siteName,
    domain,
    adminEmail,
    tlsMode,
    tlsCertPath,
    tlsKeyPath,
    databaseMode,
    databaseUrl,
    registryMode,
    registryUrl,
    resourceProfile,
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add factory/cli/src/handlers/install/interactive-setup.ts
git commit -m "feat(cli): interactive install wizard with role-driven prompts"
```

---

## Task 9: Create workbench.ts handler

**Files:**
- Create: `factory/cli/src/handlers/install/workbench.ts`

- [ ] **Step 1: Write the workbench install handler**

```typescript
// factory/cli/src/handlers/install/workbench.ts
import { select } from "@inquirer/prompts";
import ora from "ora";
import { run } from "../../lib/subprocess.js";
import { styleSuccess, styleMuted } from "../../cli-style.js";

interface WorkbenchResult {
  factoryUrl: string;
  user?: string;
  context?: string;
  dockerAvailable: boolean;
}

export async function runWorkbenchSetup(opts: {
  factoryUrl: string;
  verbose?: boolean;
}): Promise<WorkbenchResult> {
  const result: WorkbenchResult = {
    factoryUrl: opts.factoryUrl,
    dockerAvailable: false,
  };

  // Phase: Auth — reuse the existing `dx auth login` flow
  const authSpinner = ora({ text: "Authenticating...", prefixText: " " }).start();
  try {
    const { createFactoryAuthClient } = await import("../../auth-factory.js");
    const authClient = await createFactoryAuthClient();
    // Uses the same browser-based flow as `dx auth login`
    // The auth client opens a browser, user logs in, token is stored via session-token.ts
    const session = await authClient.signIn.email({
      email: "",  // Will trigger browser-based login flow
      callbackURL: "/",
    });
    const { getStoredBearerToken } = await import("../../session-token.js");
    const token = await getStoredBearerToken();
    if (token) {
      authSpinner.succeed("Authenticated");
      result.user = "authenticated";
    } else {
      authSpinner.warn("Auth skipped — run `dx auth login` later");
    }
  } catch {
    authSpinner.warn("Auth skipped — run `dx auth login` later");
  }

  // Phase: Context selection
  // Try to fetch available contexts (sites) from the factory
  try {
    const { getFactoryClient } = await import("../../client.js");
    const client = await getFactoryClient(opts.factoryUrl);
    const res = await client.api.v1.fleet.sites.get();
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      const sites = res.data as Array<{ name: string }>;
      const chosen = await select({
        message: "Context",
        choices: sites.map((s) => ({ value: s.name, name: s.name })),
      });
      result.context = chosen;
    } else {
      // No sites available yet — use factory hostname
      result.context = new URL(opts.factoryUrl).hostname;
      console.log(`  ${styleMuted(`Context: ${result.context}`)}`);
    }
  } catch {
    // Factory unreachable or no auth — graceful skip
    result.context = new URL(opts.factoryUrl).hostname;
    console.log(`  ${styleMuted("Context setup skipped — configure with `dx context set`")}`);
  }

  // Phase: Docker check
  const dockerResult = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (dockerResult.status === 0) {
    const dockerVersion = dockerResult.stdout.trim();
    const composeResult = run("docker", ["compose", "version", "--short"]);
    const composeVersion = composeResult.status === 0 ? composeResult.stdout.trim() : "not found";
    console.log(`  ${styleSuccess("✔")} Docker ${dockerVersion}  Compose ${composeVersion}`);
    result.dockerAvailable = true;
  } else {
    console.log(`  ${styleMuted("Docker not found — optional, needed for dx dev")}`);
  }

  return result;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add factory/cli/src/handlers/install/workbench.ts
git commit -m "feat(cli): workbench install handler with auth, context, docker check"
```

---

## Task 10: Update site-config.ts for store integration

**Files:**
- Modify: `factory/cli/src/lib/site-config.ts`

- [ ] **Step 1: Remove loadSiteConfig, update siteConfigToHelmValues**

The `loadSiteConfig()` function is no longer needed — config comes from the store. Keep `siteConfigToHelmValues()` but change it to accept the store config shape:

```typescript
// factory/cli/src/lib/site-config.ts
import type { DxConfig } from "../config.js";
import type { InstallRole } from "@smp/factory-shared/install-types";

/** Resource profiles: CPU/memory requests per component. */
const RESOURCE_PROFILES = {
  small: { apiCpu: "250m", apiMemory: "512Mi", reconcilerCpu: "100m", reconcilerMemory: "256Mi" },
  medium: { apiCpu: "500m", apiMemory: "1Gi", reconcilerCpu: "250m", reconcilerMemory: "512Mi" },
  large: { apiCpu: "1000m", apiMemory: "2Gi", reconcilerCpu: "500m", reconcilerMemory: "1Gi" },
} as const;

/**
 * Translate DxConfig into a flat Helm values object.
 * Only used for site/factory cluster installs.
 */
export function configToHelmValues(config: DxConfig): Record<string, string | boolean | number> {
  const role = config.role as InstallRole;
  const profile = RESOURCE_PROFILES[(config.resourceProfile as keyof typeof RESOURCE_PROFILES) || "small"];

  const values: Record<string, string | boolean | number> = {
    "global.siteName": config.siteName,
    "global.domain": config.domain,
    "global.role": role,

    "dx-api.enabled": true,
    "dx-api.mode": role,
    "dx-api.resources.requests.cpu": profile.apiCpu,
    "dx-api.resources.requests.memory": profile.apiMemory,

    "dx-reconciler.enabled": true,
    "dx-reconciler.resources.requests.cpu": profile.reconcilerCpu,
    "dx-reconciler.resources.requests.memory": profile.reconcilerMemory,

    "traefik.enabled": true,

    "tls.mode": config.tlsMode,
    "database.mode": config.databaseMode,
    "registry.mode": config.registryMode,
    "network.podCidr": config.networkPodCidr,
    "network.serviceCidr": config.networkServiceCidr,
    "admin.email": config.adminEmail,

    "dx-builder.enabled": role === "factory",
    "fleet-plane.enabled": role === "factory",
    "commerce-plane.enabled": role === "factory",
    "product-plane.enabled": role === "factory",
    "observability.aggregation.enabled": role === "factory",
  };

  if (config.tlsCertPath) values["tls.certPath"] = config.tlsCertPath;
  if (config.tlsKeyPath) values["tls.keyPath"] = config.tlsKeyPath;
  if (config.databaseMode === "external" && config.databaseUrl) {
    values["database.url"] = config.databaseUrl;
  }
  if (config.registryMode === "external" && config.registryUrl) {
    values["registry.url"] = config.registryUrl;
  }

  return values;
}

/** Write Helm values to a flat --set format for CLI usage. */
export function helmValuesToSetArgs(values: Record<string, string | boolean | number>): string[] {
  return Object.entries(values).flatMap(([k, v]) => ["--set", `${k}=${v}`]);
}
```

- [ ] **Step 2: Update helm.ts to use configToHelmValues**

In `factory/cli/src/handlers/install/helm.ts`:

1. Replace import:
```typescript
// Before:
import { siteConfigToHelmValues, helmValuesToSetArgs } from "../../lib/site-config.js";
import type { SiteConfig } from "@smp/factory-shared/site-config-schema";

// After:
import { configToHelmValues, helmValuesToSetArgs } from "../../lib/site-config.js";
import type { DxConfig } from "../../config.js";
import type { InstallRole } from "@smp/factory-shared/install-types";
```

2. Update `HelmInstallOptions`:
```typescript
export interface HelmInstallOptions {
  config: DxConfig;  // was SiteConfig
  bundlePath?: string;
  chartVersion?: string;
  registryUrl?: string;
  verbose?: boolean;
}
```

3. Update `helmInstall` body:
```typescript
const values = configToHelmValues(opts.config);  // was siteConfigToHelmValues
```

4. Update `waitForPods` call:
```typescript
await waitForPods(opts.config.role as InstallRole, opts.verbose);  // cast string to InstallRole
```

5. Same changes in `helmUpgrade`.

- [ ] **Step 3: Update post-install.ts to read from store config**

In `factory/cli/src/handlers/install/post-install.ts`:

1. Replace import:
```typescript
// Before:
import type { SiteConfig } from "@smp/factory-shared/site-config-schema";

// After:
import type { DxConfig } from "../../config.js";
```

2. Update `PostInstallOptions`:
```typescript
export interface PostInstallOptions {
  config: DxConfig;  // was SiteConfig
  helmChartVersion: string;
  dxVersion: string;
  verbose?: boolean;
}
```

3. Update field access in `runPostInstall`:
```typescript
// Before:                          // After:
config.site.domain             →    config.domain
config.site.name               →    config.siteName
config.admin.email             →    config.adminEmail
config.install.mode            →    config.installMode
config.install.factoryUrl      →    config.factoryUrl
config.role                    →    config.role as InstallRole
```

4. Update `buildManifest`:
```typescript
function buildManifest(opts: PostInstallOptions): InstallManifest {
  const { config } = opts;
  const hostnameResult = run("hostname", []);
  const hostname = hostnameResult.stdout.trim() || "unknown";
  const ipResult = run("hostname", ["-I"]);
  const ip = ipResult.stdout.trim().split(" ")[0] ?? "unknown";

  return {
    version: 1,
    role: config.role as InstallRole,
    installedAt: new Date().toISOString(),
    dxVersion: opts.dxVersion,
    installMode: config.installMode as "connected" | "offline",
    k3sVersion: getK3sVersion(),
    helmChartVersion: opts.helmChartVersion,
    siteName: config.siteName,
    domain: config.domain,
    enabledPlanes: planesForRole(config.role as InstallRole),
    nodes: [{ name: hostname, role: "server", joinedAt: new Date().toISOString(), ip }],
    upgrades: [],
  };
}
```

5. Update `registerWithFactory` call:
```typescript
// Before:
if (config.install.mode === "connected" && config.install.factoryUrl) {
  await registerWithFactory(config.install.factoryUrl, config.site.name, manifest, opts.verbose);
}
if (config.role === "factory" && !config.install.factoryUrl) {
  await registerWithFactory(apiBase, config.site.name, manifest, opts.verbose);
}

// After:
if (config.installMode === "connected" && config.factoryUrl) {
  await registerWithFactory(config.factoryUrl, config.siteName, manifest, opts.verbose);
}
if (config.role === "factory" && !config.factoryUrl) {
  await registerWithFactory(apiBase, config.siteName, manifest, opts.verbose);
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add factory/cli/src/lib/site-config.ts factory/cli/src/handlers/install/helm.ts factory/cli/src/handlers/install/post-install.ts
git commit -m "refactor(cli): update site-config and handlers to use store config"
```

---

## Task 11: Rewrite install.ts — the main event

**Files:**
- Rewrite: `factory/cli/src/commands/install.ts`

This wires everything together: banner, preflight, wizard, role branching, spinners.

- [ ] **Step 1: Write the new install command**

```typescript
// factory/cli/src/commands/install.ts
import type { DxBase } from "../dx-root.js";
import { ExitCodes } from "@smp/factory-shared/exit-codes";
import type { InstallRole } from "@smp/factory-shared/install-types";
import { exitWithError } from "../lib/cli-exit.js";
import { dxConfigStore, configExists, readConfig } from "../config.js";
import { banner, phase, phaseSucceed, phaseFail, printPreflightLine, successLine, infoLine, formatElapsed } from "../lib/cli-ui.js";
import { toDxFlags } from "./dx-flags.js";

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev";

export function installCommand(app: DxBase) {
  return app
    .sub("install")
    .meta({ description: "Install, upgrade, and manage the dx platform" })
    .flags({
      config: { type: "string", short: "c", description: "Path to config file" },
      bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
      role: { type: "string", description: "Installation role: workbench, site, or factory" },
      force: { type: "boolean", description: "Force install over existing installation" },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const totalStart = Date.now();

      try {
        banner(DX_VERSION);

        // Load or create config via wizard
        let config = await readConfig();
        const hasExistingConfig = configExists();

        if (hasExistingConfig && config.role) {
          console.log(`  Config found: ${config.role} (${config.context || config.siteName || new URL(config.factoryUrl).hostname})\n`);
        } else {
          // Run light preflight before wizard (role-agnostic)
          console.log("  Checking system...");
          const { runPreflight } = await import("../handlers/install/preflight.js");
          const lightPreflight = runPreflight({
            role: (flags.role as InstallRole) || "workbench",
          });
          printPreflightLine(lightPreflight.checks);
          console.log();

          if (!lightPreflight.passed) {
            exitWithError(f, "System requirements not met.", ExitCodes.PREFLIGHT_FAILURE);
          }

          // Interactive wizard
          const { runWizard } = await import("../handlers/install/interactive-setup.js");
          const wizard = await runWizard(config);

          // Write wizard results to store
          await dxConfigStore.write({
            role: wizard.role,
            factoryUrl: wizard.factoryUrl,
            siteUrl: wizard.siteUrl,
            context: config.context,
            authBasePath: config.authBasePath,
            siteName: wizard.siteName,
            domain: wizard.domain,
            adminEmail: wizard.adminEmail,
            tlsMode: wizard.tlsMode,
            tlsCertPath: wizard.tlsCertPath,
            tlsKeyPath: wizard.tlsKeyPath,
            databaseMode: wizard.databaseMode,
            databaseUrl: wizard.databaseUrl,
            registryMode: wizard.registryMode,
            registryUrl: wizard.registryUrl,
            resourceProfile: wizard.resourceProfile,
            networkPodCidr: config.networkPodCidr,
            networkServiceCidr: config.networkServiceCidr,
            installMode: config.installMode,
          });

          // Re-read config with wizard values
          config = await readConfig();
        }

        // CLI --role flag overrides config
        const role: InstallRole = (flags.role as InstallRole) || (config.role as InstallRole);

        // Branch on role
        if (role === "workbench") {
          const { runWorkbenchSetup } = await import("../handlers/install/workbench.js");
          const result = await runWorkbenchSetup({
            factoryUrl: config.factoryUrl,
            verbose: f.verbose,
          });

          successLine(`Workbench ready — ${new URL(config.factoryUrl).hostname}`, Date.now() - totalStart);
          infoLine("dx dev       local dev server");
          infoLine("dx deploy    deploy to site");
          infoLine("dx status    check platform");
          console.log();

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: result }, null, 2));
          }
          return;
        }

        // Site/Factory — 6-phase cluster install
        console.log();
        const TOTAL_PHASES = 6;

        // Phase 1: Full preflight
        let s = phase(1, TOTAL_PHASES, "Preflight");
        let start = Date.now();
        const { runPreflight } = await import("../handlers/install/preflight.js");
        const preflight = runPreflight({
          role,
          domain: config.domain,
          installMode: config.installMode,
          force: flags.force as boolean | undefined,
        });
        if (!preflight.passed) {
          phaseFail(s, 1, TOTAL_PHASES, "Preflight", "checks failed");
          printPreflightLine(preflight.checks.filter((c) => !c.passed));
          exitWithError(f, "Preflight checks failed.", ExitCodes.PREFLIGHT_FAILURE);
        }
        phaseSucceed(s, 1, TOTAL_PHASES, "Preflight", start);

        // Phase 2: K3s
        s = phase(2, TOTAL_PHASES, "K3s bootstrap");
        start = Date.now();
        const { bootstrapK3s } = await import("../handlers/install/k3s.js");
        await bootstrapK3s({
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        phaseSucceed(s, 2, TOTAL_PHASES, "K3s bootstrap", start);

        // Phase 3: Images
        s = phase(3, TOTAL_PHASES, "Loading images");
        start = Date.now();
        const { loadImages } = await import("../handlers/install/images.js");
        loadImages({
          role,
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        phaseSucceed(s, 3, TOTAL_PHASES, "Loading images", start);

        // Phase 4: Helm install
        s = phase(4, TOTAL_PHASES, "Installing platform");
        start = Date.now();
        const { helmInstall } = await import("../handlers/install/helm.js");
        const chartVersion = await helmInstall({
          config,
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        phaseSucceed(s, 4, TOTAL_PHASES, "Installing platform", start);

        // Phase 5: Post-install
        s = phase(5, TOTAL_PHASES, "Post-install");
        start = Date.now();
        const { runPostInstall } = await import("../handlers/install/post-install.js");
        const manifest = await runPostInstall({
          config,
          helmChartVersion: chartVersion,
          dxVersion: DX_VERSION,
          verbose: f.verbose,
        });
        phaseSucceed(s, 5, TOTAL_PHASES, "Post-install", start);

        // Phase 6: Health
        s = phase(6, TOTAL_PHASES, "Health check");
        start = Date.now();
        const { verifyHealth } = await import("../handlers/install/health.js");
        const healthy = await verifyHealth({
          role,
          domain: config.domain,
          verbose: f.verbose,
        });
        if (!healthy) {
          phaseFail(s, 6, TOTAL_PHASES, "Health check", "verification failed");
          exitWithError(f, "Health verification failed.", ExitCodes.INSTALL_PHASE_FAILURE);
        }
        phaseSucceed(s, 6, TOTAL_PHASES, "Health check", start);

        // Success
        const label = role === "factory" ? "Factory" : "Site";
        successLine(`${label} ready — https://${config.domain}`, Date.now() - totalStart);
        infoLine(`Config: ${(await import("../config.js")).configPath()}`);
        console.log();

        if (f.json) {
          console.log(JSON.stringify({ success: true, data: manifest }, null, 2));
        }
      } catch (err) {
        // Ctrl+C from @inquirer/prompts
        if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ExitPromptError") {
          console.log("\n  Install cancelled.");
          process.exit(1);
        }
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg, ExitCodes.INSTALL_PHASE_FAILURE);
      }
    })

    // --- Subcommands ---

    .command("preflight", (c) =>
      c
        .meta({ description: "Run preflight checks only (dry run)" })
        .flags({
          role: { type: "string", description: "Installation role: workbench, site, or factory" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            let role: InstallRole = (flags.role as InstallRole) || "workbench";
            if (!flags.role) {
              // If no role flag and no config, prompt
              if (!configExists()) {
                const { select } = await import("@inquirer/prompts");
                role = await select<InstallRole>({
                  message: "Role",
                  choices: [
                    { value: "workbench", name: "Workbench" },
                    { value: "site", name: "Site" },
                    { value: "factory", name: "Factory" },
                  ],
                });
              } else {
                const config = await readConfig();
                role = config.role as InstallRole;
              }
            }

            const { runPreflight } = await import("../handlers/install/preflight.js");
            const result = runPreflight({ role });

            printPreflightLine(result.checks);

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: result }, null, 2));
            }

            if (!result.passed) process.exit(ExitCodes.PREFLIGHT_FAILURE);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.PREFLIGHT_FAILURE);
          }
        })
    )

    .command("upgrade", (c) =>
      c
        .meta({ description: "Upgrade an existing dx platform installation" })
        .flags({
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
          version: { type: "string", description: "Target version" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { runUpgrade } = await import("../handlers/install/upgrade.js");
            await runUpgrade({
              bundlePath: flags.bundle as string | undefined,
              version: flags.version as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.UPGRADE_FAILURE);
          }
        })
    )

    .command("join", (c) =>
      c
        .meta({ description: "Join this node to an existing dx cluster" })
        .flags({
          server: { type: "string", required: true, description: "Server URL" },
          token: { type: "string", required: true, description: "Join token" },
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { runJoin } = await import("../handlers/install/join.js");
            await runJoin({
              server: flags.server as string,
              token: flags.token as string,
              bundlePath: flags.bundle as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.JOIN_FAILURE);
          }
        })
    )

    .command("status", (c) =>
      c
        .meta({ description: "Show install manifest and status" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { spawnSync } = await import("node:child_process");
            const proc = spawnSync("kubectl", [
              "get", "configmap", "dx-install-manifest",
              "-n", "dx-system",
              "--kubeconfig", "/etc/rancher/k3s/k3s.yaml",
              "-o", "jsonpath={.data.manifest\\.json}",
            ], { encoding: "utf8" });

            if (proc.status !== 0) {
              exitWithError(f, "No install manifest found. Is dx-platform installed?", ExitCodes.NOT_FOUND);
            }

            const manifest = JSON.parse(proc.stdout);
            const { printKeyValue, printTable } = await import("../output.js");

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: manifest }, null, 2));
            } else {
              console.log(printKeyValue({
                "Site": manifest.siteName,
                "Domain": manifest.domain,
                "Role": manifest.role,
                "Version": manifest.dxVersion,
                "Mode": manifest.installMode,
                "Installed": manifest.installedAt,
              }));

              if (manifest.nodes?.length > 0) {
                console.log("\nNodes:");
                console.log(printTable(
                  ["Name", "Role", "IP", "Joined"],
                  manifest.nodes.map((n: { name: string; role: string; ip: string; joinedAt: string }) => [
                    n.name, n.role, n.ip, n.joinedAt,
                  ])
                ));
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    )

    .command("uninstall", (c) =>
      c
        .meta({ description: "Tear down dx platform" })
        .flags({
          keepK3s: { type: "boolean", description: "Keep k3s installed (only remove dx-platform)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { runUninstall } = await import("../handlers/install/uninstall.js");
            await runUninstall({
              keepK3s: flags.keepK3s as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

Fix any remaining type errors — the main ones will be in `helm.ts` and `post-install.ts` if they still expect the old `SiteConfig` type.

- [ ] **Step 3: Manual smoke test**

Run: `cd factory/cli && bun run src/cli.ts install --help`

Verify the help output shows the updated command description and flags.

- [ ] **Step 4: Commit**

```bash
git add factory/cli/src/commands/install.ts
git commit -m "feat(cli): rewrite dx install with interactive wizard, spinners, role branching"
```

---

## Task 12: Clean up upgrade.ts configPath reference

**Files:**
- Modify: `factory/cli/src/handlers/install/upgrade.ts`

- [ ] **Step 1: Read upgrade.ts**

Read the file to understand how it loads config. It currently takes `configPath` and calls `loadSiteConfig()`.

- [ ] **Step 2: Update to use store**

Replace `loadSiteConfig(configPath)` with `readConfig()` from the new config module. Remove the `configPath` option since config now comes from the store.

- [ ] **Step 3: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add factory/cli/src/handlers/install/upgrade.ts
git commit -m "refactor(cli): update upgrade handler to use config store"
```

---

## Task 13: Update remaining callers of loadConfig

**Files:**
- Modify: various files that import from `config.ts`

- [ ] **Step 1: Find all callers**

Run: `grep -r "loadConfig\|saveConfig" factory/cli/src/ --include="*.ts" -l`

These are the files still using the old sync `loadConfig()`. The legacy shim keeps them working, but we should migrate the most important ones (especially `commands/site.ts` which uses `getSiteApiUrl()`).

- [ ] **Step 2: Migrate critical callers to readConfig()**

For files that are called during install or use `apiUrl`/`siteUrl`, update them to use `readConfig()` (async). For others, the legacy `loadConfig()` shim is fine for now.

Priority files to migrate:
- `factory/cli/src/handlers/status.ts` — reads `apiUrl`
- `factory/cli/src/commands/site.ts` — reads `siteUrl`/`apiUrl`
- `factory/cli/src/lib/tunnel-client.ts` — reads `apiUrl`

- [ ] **Step 3: Verify typecheck**

Run: `cd factory/cli && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add factory/cli/src/
git commit -m "refactor(cli): migrate callers from loadConfig to readConfig"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Test wizard flow**

Run: `cd factory/cli && bun run src/cli.ts install`

Verify:
- Banner prints with version
- Preflight checks run (expect failures on macOS — that's correct, workbench doesn't need root/linux)
- Role select appears
- Selecting "Workbench" shows factory URL prompt
- Config is written to `~/.config/dx/config.json`

- [ ] **Step 2: Test re-run with existing config**

Run: `cd factory/cli && bun run src/cli.ts install`

Verify:
- Shows "Config found: workbench (...)"
- Skips wizard

- [ ] **Step 3: Test preflight subcommand**

Run: `cd factory/cli && bun run src/cli.ts install preflight --role workbench`

Verify: one-line output with check results.

- [ ] **Step 4: Test --json flag**

Run: `cd factory/cli && bun run src/cli.ts install --json`

Verify: JSON output at the end.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(cli): dx install interactive setup with workbench/site/factory roles"
```
