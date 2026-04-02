# dx install — Interactive Setup with Rich CLI UX

**Date:** 2026-03-25
**Status:** Draft

## Problem

1. `dx install` without config crashes with `Cannot read config file`. Should run an interactive setup wizard.
2. Post-install, CLI commands fail with `ConnectionRefused` to `http://127.0.0.1:4100` because the config was never set up.

## Conceptual Model

One **Factory** (control plane). Everything else is a **Site** (edge deployment) or **Workbench** (developer/agent).

## Roles

| | Workbench | Site | Factory |
|---|---|---|---|
| **Who** | Developer / agent | Edge deployment | Control plane |
| **k3s/Helm** | No | Yes | Yes |
| **Planes** | None | control, service, data | All 11 |
| **Min disk** | 2GB | 20GB | 50GB |
| **Root** | No | Yes | Yes |
| **Ports** | None | 6443, 443, 80, 10250 | Same |
| **OS** | Any | Linux | Linux |
| **Manifest** | No | Yes | Yes |

## Config Architecture

### Single Config, Two Scopes

| Scope | Location | Purpose |
|---|---|---|
| **Global** | `~/.config/dx/config.json` via `@crustjs/store` | Default config. Written by `dx install`. |
| **Project-local** | `.dx/config.json` in project dir | Optional override for multi-site machines. |

Resolution: project-local > global > defaults.

### Store Schema

```typescript
export const dxConfigStore = createStore({
  dirPath: configDir("dx"),
  name: "config",
  fields: {
    // Role
    role: { type: "string", default: "workbench" },

    // Connection (all roles)
    factoryUrl: { type: "string", default: "https://factory.rio.software" },
    siteUrl: { type: "string", default: "" },
    context: { type: "string", default: "" },

    // Auth (always through factory)
    authBasePath: { type: "string", default: "/api/v1/auth" },

    // Cluster install (site/factory only) — good defaults, advanced users edit config
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
  },
});
```

### URL Model

| Field | Required | Description |
|---|---|---|
| `factoryUrl` | Always | Factory API. Default: `https://factory.rio.software`. Auth goes through here. |
| `siteUrl` | Site/Factory | Local site API. Set during cluster install. |

**Per-role after install:**

| | `factoryUrl` | `siteUrl` |
|---|---|---|
| **Factory** | `https://{domain}` (self) | `https://{domain}` (same) |
| **Site** | `https://factory.rio.software` (remote) | `https://{domain}` (local) |
| **Workbench** | `https://factory.rio.software` (remote) | empty or set if connected to site |

Commands explicitly use the right URL — `getFactoryClient()` reads `factoryUrl`, `getSiteClient()` reads `siteUrl`. No mode-based routing.

### Migration

Replaces hand-rolled `config.ts` YAML (`loadConfig`/`saveConfig`) with `@crustjs/store`. Session store (`session.json`) unchanged.

## Wizard Flows

### Minimal prompts, optional advanced mode

Essential questions only (2-3 per role). Then one gate: "Use defaults or customize?" If customize, expand advanced prompts inline. Config file is always available for later edits regardless.

### Factory

```
$ dx install

  dx platform installer v0.0.2

  Checking system...
  ✔ root  ✔ linux/x64  ✔ disk 84GB  ✔ ports clear

  ? Role        › ○ Workbench  ○ Site  ● Factory
  ? Domain      › factory.rio.software
  ? Admin email › nikhil@saraf.com
  ? Advanced (TLS, database, resources) › ● Use defaults  ○ Customize

  [1/6] Preflight ✔ 0.2s
  [2/6] K3s bootstrap ✔ 34s
  [3/6] Loading images ✔ 12s
  [4/6] Installing platform ✔ 67s
  [5/6] Post-install ✔ 8s
  [6/6] Health check ✔ 5s

  ✔ Factory ready — https://factory.rio.software (2m 8s)
    Config: ~/.config/dx/config.json
```

**If "Customize" is selected:**
```
  ? Advanced (TLS, database, resources) › ○ Use defaults  ● Customize
  ? TLS       › ● Self-signed  ○ Let's Encrypt  ○ Provided
  ? Database  › ● Embedded  ○ External
  ? Resources › ○ Small  ● Medium  ○ Large
  ? Registry  › ● Embedded  ○ External

  [1/6] Preflight ✔ 0.2s
  ...
```

"Provided" TLS expands to cert/key path inputs. "External" database expands to connection URL input.

Factory auto-sets `factoryUrl = https://{domain}` and `siteUrl = https://{domain}`.

### Site

```
$ dx install

  dx platform installer v0.0.2

  Checking system...
  ✔ root  ✔ linux/x64  ✔ disk 42GB  ✔ ports clear

  ? Role        › ○ Workbench  ● Site  ○ Factory
  ? Site name   › edge-us-west
  ? Domain      › edge-us-west.rio.software
  ? Admin email › nikhil@saraf.com
  ? Factory URL › https://factory.rio.software
  ? Advanced (TLS, database, resources) › ● Use defaults  ○ Customize

  [1/6] Preflight ✔ 0.2s
  [2/6] K3s bootstrap ✔ 34s
  [3/6] Loading images ✔ 8s
  [4/6] Installing platform ✔ 52s
  [5/6] Post-install ✔ 6s
  [6/6] Health check ✔ 4s

  ✔ Site ready — https://edge-us-west.rio.software (1m 44s)
    Config: ~/.config/dx/config.json
```

Site sets `siteUrl = https://{domain}` and `factoryUrl` from the prompt.

### Workbench

```
$ dx install

  dx platform installer v0.0.2

  Checking system...
  ✔ darwin/arm64  ✔ disk 142GB

  ? Role        › ● Workbench  ○ Site  ○ Factory
  ? Factory URL › https://factory.rio.software

  Authenticating...
  ✔ nikhil@saraf.com

  ? Context › ● factory-prod  ○ staging

  ✔ Workbench ready — factory.rio.software
    dx dev       local dev server
    dx deploy    deploy to site
    dx status    check platform
```

No advanced options for workbench — nothing to configure.

### Re-run (config exists)

```
$ dx install

  dx platform installer v0.0.2

  Config found: factory (factory-prod)

  [1/6] Preflight ✔ 0.2s
  ...
```

## Preflight

One-line output, role-aware:

| Check | Workbench | Site | Factory |
|---|---|---|---|
| Root | Skip | Required | Required |
| OS | Any (info) | Linux | Linux |
| Arch | x64/arm64 | x64/arm64 | x64/arm64 |
| Disk | 2GB | 20GB | 50GB |
| Ports | Skip | 6443, 443, 80, 10250 | Same |
| Existing k3s | Skip | Check | Check |
| DNS | Skip | Optional | Optional |

Failures on required checks: print red `✖`, exit with `PREFLIGHT_FAILURE` (20).

## `dx install preflight` Subcommand

When no config and no `--role` flag: prompt for role (single select). When `--role` provided: run role-specific checks without full config.

## Type Changes

### `InstallRole` (install-types.ts)

```typescript
export type InstallRole = "workbench" | "site" | "factory";
```

Add `WORKBENCH_PLANES = [] as const`, update `planesForRole()`.

`bundleManifestSchema` keeps `z.enum(["site", "factory"])` — cluster-only.
`InstallManifest` unchanged — cluster-only.

## Exit Codes

Reuse existing:
- `AUTH_FAILURE` (3) — auth failure
- `CONNECTION_FAILURE` (4) — factory unreachable
- `PREFLIGHT_FAILURE` (20) — preflight failure
- `GENERAL_FAILURE` (1) — wizard/setup failure

## Ctrl+C

`@inquirer/prompts` throws on ctrl+C. Top-level catch prints `"\nInstall cancelled."`, exits cleanly.

## Files

| File | Action | Description |
|---|---|---|
| `factory/shared/src/install-types.ts` | Modify | Add `"workbench"` to `InstallRole`, `WORKBENCH_PLANES`, update `planesForRole()` |
| `factory/cli/package.json` | Modify | Add `@inquirer/prompts`, `ora` |
| `factory/cli/src/config.ts` | Rewrite | `@crustjs/store` backed `dxConfigStore`. Explicit `factoryUrl`/`siteUrl`. Project-local `.dx/config.json` overlay. Export `resolveFactoryUrl()`/`resolveSiteUrl()`. |
| `factory/cli/src/client.ts` | Modify | `getFactoryClient()` reads `factoryUrl` from store. Add `getSiteClient()` for `siteUrl`. |
| `factory/cli/src/lib/cli-ui.ts` | Create | `banner()`, `phase()` (ora spinner with `[n/total]`), `preflightLine()`, `elapsed()` |
| `factory/cli/src/handlers/install/interactive-setup.ts` | Create | Wizard: role select, then role-specific prompts (2-3 questions each) |
| `factory/cli/src/handlers/install/workbench.ts` | Create | Workbench flow: auth, context, docker check |
| `factory/cli/src/handlers/install/preflight.ts` | Modify | Three-tier role-aware, one-line output format |
| `factory/cli/src/commands/install.ts` | Modify | Role branching, spinners, banner, ctrl+C, minimal output |
| `factory/cli/src/lib/site-config.ts` | Modify | Remove `loadSiteConfig`. Keep `siteConfigToHelmValues()` reading from store for cluster installs. |
| `factory/shared/src/site-config-schema.ts` | Modify | Helm values validation only (site/factory). No longer the install config schema. |

## Dependencies

- `@inquirer/prompts` — prompts (in lockfile via `lepton-cloud`)
- `ora` — spinners (needs adding to lockfile)
- `@crustjs/store` — already a dependency
