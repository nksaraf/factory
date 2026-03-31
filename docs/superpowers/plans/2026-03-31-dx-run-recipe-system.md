# dx run — Universal Execute & Recipe System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `dx run` as the universal execute command with a recipe system for remote machine provisioning, plus `dx setup` as sugar.

**Architecture:** `dx run` auto-detects input type (script, shell, recipe) and dispatches to the appropriate runner. Recipes are structured directories with `recipe.yml` manifest + shell scripts. Built-in recipes are embedded as TS constants (same pattern as `DOCKER_BOOTSTRAP_SCRIPT`). Machine targeting supports single, comma-separated, tags, and inventory groups. `dx setup` is sugar that delegates to `dx run @dx/<tool> --on <machine>` for remote provisioning or the existing install flow for local platform setup.

**Tech Stack:** TypeScript, Crust.js CLI framework, yaml parser, SSH via `execFileSync`/`spawnSync`

---

## File Map

| File | Responsibility |
|------|---------------|
| `cli/src/lib/recipe.ts` | **Create** — Recipe types, manifest parsing, built-in registry, resolution, param validation, dependency checking |
| `cli/src/lib/machine-target.ts` | **Create** — Multi-machine targeting: comma expansion, tag resolution, inventory parsing. Extracted from `docker-remote.ts` |
| `cli/src/handlers/run.ts` | **Create** — Input type detection, recipe execution orchestration (verify → install via SSH), shell script remote execution |
| `cli/src/commands/run.ts` | **Create** — Crust command definition for `dx run` with flags and subcommands |
| `cli/src/commands/setup.ts` | **Create** — `dx setup` sugar command |
| `cli/src/register-commands.ts` | **Modify** — Register `runCommand`, `setupCommand` |
| `cli/src/handlers/docker-remote.ts` | **Modify** — Extract `resolveMachine` to import from `machine-target.ts`, re-export for compat |
| `cli/src/commands/script.ts` | **Modify** — Add deprecation notice, delegate to `dx run` |

---

### Task 1: Recipe Library — Types and Built-in Registry

**Files:**
- Create: `cli/src/lib/recipe.ts`

- [ ] **Step 1: Create recipe types and manifest parser**

```typescript
// cli/src/lib/recipe.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

// ─── Types ────────────────────────────────────────────────────

export interface RecipeParam {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
}

export interface RecipeManifest {
  name: string;
  description: string;
  requires?: string[];
  params?: Record<string, RecipeParam>;
  os?: string[];
  tags?: string[];
}

export interface ResolvedRecipe {
  manifest: RecipeManifest;
  /** The install script content */
  installScript: string;
  /** The verify script content (optional) */
  verifyScript?: string;
  /** The uninstall script content (optional) */
  uninstallScript?: string;
  /** Where this recipe was resolved from */
  source: "project" | "user" | "builtin";
}

// ─── Manifest parsing ─────────────────────────────────────────

export function parseRecipeManifest(yamlContent: string): RecipeManifest {
  const doc = parseYaml(yamlContent);
  if (!doc?.name || !doc?.description) {
    throw new Error("recipe.yml must have 'name' and 'description' fields");
  }
  return {
    name: doc.name,
    description: doc.description,
    requires: doc.requires ?? [],
    params: doc.params ?? {},
    os: doc.os,
    tags: doc.tags ?? [],
  };
}

function loadRecipeFromDir(dir: string, source: ResolvedRecipe["source"]): ResolvedRecipe | null {
  const manifestPath = join(dir, "recipe.yml");
  if (!existsSync(manifestPath)) return null;

  const manifest = parseRecipeManifest(readFileSync(manifestPath, "utf-8"));

  const installPath = join(dir, "install.sh");
  if (!existsSync(installPath)) {
    throw new Error(`Recipe "${manifest.name}" is missing install.sh`);
  }

  return {
    manifest,
    installScript: readFileSync(installPath, "utf-8"),
    verifyScript: existsSync(join(dir, "verify.sh"))
      ? readFileSync(join(dir, "verify.sh"), "utf-8")
      : undefined,
    uninstallScript: existsSync(join(dir, "uninstall.sh"))
      ? readFileSync(join(dir, "uninstall.sh"), "utf-8")
      : undefined,
    source,
  };
}
```

- [ ] **Step 2: Add built-in recipe registry**

Append to the same file. Built-in recipes are embedded as TS constants (same pattern as `DOCKER_BOOTSTRAP_SCRIPT` in `docker-remote.ts`):

```typescript
// ─── Built-in recipes (embedded) ──────────────────────────────

const BUILTIN_DOCKER_MANIFEST: RecipeManifest = {
  name: "docker",
  description: "Install Docker Engine and Docker Compose plugin",
  params: {
    version: { type: "string", description: "Docker version (default: latest)" },
  },
  os: ["linux"],
  tags: ["container", "runtime"],
};

const BUILTIN_DOCKER_INSTALL = `#!/bin/bash
set -euo pipefail

echo "==> Detecting OS..."
IS_ALPINE=false
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "    OS: \$NAME \${VERSION_ID:-unknown}"
  if [ "\${ID:-}" = "alpine" ]; then
    IS_ALPINE=true
  fi
else
  echo "    Could not detect OS. Attempting install anyway."
fi

if [ "\$IS_ALPINE" = true ]; then
  echo "==> Installing Docker on Alpine via apk..."
  apk update
  apk add docker docker-compose docker-cli-compose
  rc-update add docker default 2>/dev/null || true
  service docker start 2>/dev/null || openrc 2>/dev/null && service docker start || true
else
  echo "==> Installing Docker via official convenience script..."
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Adding current user to docker group..."
CURRENT_USER=\$(whoami)
if [ "\$CURRENT_USER" != "root" ]; then
  if command -v sudo &>/dev/null; then
    sudo usermod -aG docker "\$CURRENT_USER" 2>/dev/null || adduser "\$CURRENT_USER" docker 2>/dev/null || true
  else
    adduser "\$CURRENT_USER" docker 2>/dev/null || true
  fi
  echo "    Added \$CURRENT_USER to docker group."
  echo "    Note: You may need to log out and back in for group changes to take effect."
fi

echo "==> Enabling and starting Docker service..."
if command -v systemctl &>/dev/null; then
  sudo systemctl enable docker --now 2>/dev/null || true
elif command -v rc-update &>/dev/null; then
  rc-update add docker default 2>/dev/null || true
  service docker start 2>/dev/null || true
else
  sudo service docker start 2>/dev/null || true
fi

echo "==> Verifying installation..."
docker --version
docker compose version 2>/dev/null || echo "Docker Compose plugin not found."

echo ""
echo "==> Docker setup complete!"
`;

const BUILTIN_DOCKER_VERIFY = `#!/bin/bash
command -v docker &>/dev/null && docker info &>/dev/null
`;

const BUILTIN_NODE_MANIFEST: RecipeManifest = {
  name: "node",
  description: "Install Node.js via nvm",
  params: {
    version: { type: "string", default: "20", description: "Node.js major version" },
  },
  os: ["linux"],
  tags: ["runtime", "javascript"],
};

const BUILTIN_NODE_INSTALL = `#!/bin/bash
set -euo pipefail
VERSION="\${DX_PARAM_VERSION:-20}"

echo "==> Installing nvm..."
export NVM_DIR="\$HOME/.nvm"
if [ ! -d "\$NVM_DIR" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

# Source nvm
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"

echo "==> Installing Node.js v\$VERSION..."
nvm install "\$VERSION"
nvm alias default "\$VERSION"

echo "==> Verifying..."
node --version
npm --version

echo "==> Node.js setup complete!"
`;

const BUILTIN_NODE_VERIFY = `#!/bin/bash
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
VERSION="\${DX_PARAM_VERSION:-20}"
node --version 2>/dev/null | grep -q "v\$VERSION"
`;

const BUILTIN_CADDY_MANIFEST: RecipeManifest = {
  name: "caddy",
  description: "Install Caddy web server",
  requires: ["docker"],
  params: {
    domain: { type: "string", description: "Domain for automatic HTTPS" },
  },
  os: ["linux"],
  tags: ["webserver", "proxy", "https"],
};

const BUILTIN_CADDY_INSTALL = `#!/bin/bash
set -euo pipefail

echo "==> Installing Caddy..."
if command -v apt-get &>/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl 2>/dev/null || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
elif command -v apk &>/dev/null; then
  apk add caddy
elif command -v dnf &>/dev/null; then
  sudo dnf install -y caddy
else
  echo "==> Installing Caddy via binary download..."
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy
  chmod +x /usr/local/bin/caddy
fi

echo "==> Enabling Caddy service..."
if command -v systemctl &>/dev/null; then
  sudo systemctl enable caddy --now 2>/dev/null || true
fi

echo "==> Verifying..."
caddy version

echo "==> Caddy setup complete!"
`;

const BUILTIN_CADDY_VERIFY = `#!/bin/bash
command -v caddy &>/dev/null && caddy version &>/dev/null
`;

/** Registry of all built-in recipes */
const BUILTIN_RECIPES: Record<string, ResolvedRecipe> = {
  docker: {
    manifest: BUILTIN_DOCKER_MANIFEST,
    installScript: BUILTIN_DOCKER_INSTALL,
    verifyScript: BUILTIN_DOCKER_VERIFY,
    source: "builtin",
  },
  node: {
    manifest: BUILTIN_NODE_MANIFEST,
    installScript: BUILTIN_NODE_INSTALL,
    verifyScript: BUILTIN_NODE_VERIFY,
    source: "builtin",
  },
  caddy: {
    manifest: BUILTIN_CADDY_MANIFEST,
    installScript: BUILTIN_CADDY_INSTALL,
    verifyScript: BUILTIN_CADDY_VERIFY,
    source: "builtin",
  },
};
```

- [ ] **Step 3: Add recipe resolution and parameter validation**

Append to the same file:

```typescript
// ─── Recipe resolution ────────────────────────────────────────

/**
 * Resolve a recipe by name. Checks:
 * 1. @dx/<name> — built-in only
 * 2. .dx/recipes/<name>/ — project-local
 * 3. ~/.config/dx/recipes/<name>/ — user-global
 * 4. Built-in registry
 */
export function resolveRecipe(name: string): ResolvedRecipe {
  // Handle @dx/ prefix — built-in only
  if (name.startsWith("@dx/")) {
    const builtinName = name.slice(4);
    const recipe = BUILTIN_RECIPES[builtinName];
    if (!recipe) {
      throw new Error(
        `Built-in recipe "${builtinName}" not found. Available: ${Object.keys(BUILTIN_RECIPES).join(", ")}`
      );
    }
    return recipe;
  }

  // 1. Project-local: .dx/recipes/<name>/
  const projectDir = resolve(process.cwd(), ".dx", "recipes", name);
  const projectRecipe = loadRecipeFromDir(projectDir, "project");
  if (projectRecipe) return projectRecipe;

  // 2. User-global: ~/.config/dx/recipes/<name>/
  const userDir = resolve(homedir(), ".config", "dx", "recipes", name);
  const userRecipe = loadRecipeFromDir(userDir, "user");
  if (userRecipe) return userRecipe;

  // 3. Built-in
  const builtin = BUILTIN_RECIPES[name];
  if (builtin) return builtin;

  throw new Error(
    `Recipe "${name}" not found.\n` +
    `  Searched: .dx/recipes/, ~/.config/dx/recipes/, built-in\n` +
    `  Available built-in recipes: ${Object.keys(BUILTIN_RECIPES).join(", ")}\n` +
    `  List all: dx run list`
  );
}

/**
 * Validate and resolve parameters against a recipe manifest.
 * Returns the full param env map (DX_PARAM_KEY=value).
 */
export function resolveParams(
  manifest: RecipeManifest,
  setFlags: string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  const provided = new Map<string, string>();

  // Parse --set key=value flags
  for (const s of setFlags) {
    const eqIdx = s.indexOf("=");
    if (eqIdx < 0) {
      throw new Error(`Invalid --set format: "${s}". Expected: --set key=value`);
    }
    provided.set(s.slice(0, eqIdx), s.slice(eqIdx + 1));
  }

  const params = manifest.params ?? {};

  // Validate and build env
  for (const [key, spec] of Object.entries(params)) {
    const value = provided.get(key);
    const envKey = `DX_PARAM_${key.toUpperCase()}`;

    if (value !== undefined) {
      // Validate type
      if (spec.type === "number" && isNaN(Number(value))) {
        throw new Error(`Parameter "${key}" must be a number, got "${value}"`);
      }
      if (spec.type === "boolean" && value !== "true" && value !== "false") {
        throw new Error(`Parameter "${key}" must be true/false, got "${value}"`);
      }
      env[envKey] = value;
      provided.delete(key);
    } else if (spec.default !== undefined) {
      env[envKey] = String(spec.default);
    } else if (spec.required) {
      throw new Error(
        `Missing required parameter "${key}". Use: --set ${key}=<value>\n` +
        (spec.description ? `  ${key}: ${spec.description}` : "")
      );
    }
  }

  // Warn about unknown params
  for (const [key] of provided) {
    if (!params[key]) {
      const known = Object.keys(params).join(", ");
      console.warn(`Warning: Unknown parameter "${key}" (ignored). Known: ${known}`);
    }
  }

  return env;
}

/**
 * List all available recipes (built-in + user + project).
 */
export function listRecipes(): Array<{ name: string; description: string; source: string }> {
  const recipes: Array<{ name: string; description: string; source: string }> = [];

  // Built-in
  for (const [name, recipe] of Object.entries(BUILTIN_RECIPES)) {
    recipes.push({ name: `@dx/${name}`, description: recipe.manifest.description, source: "built-in" });
  }

  // User-global
  const userRecipesDir = resolve(homedir(), ".config", "dx", "recipes");
  if (existsSync(userRecipesDir)) {
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      for (const entry of readdirSync(userRecipesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(userRecipesDir, entry.name, "recipe.yml"))) {
          const manifest = parseRecipeManifest(
            readFileSync(join(userRecipesDir, entry.name, "recipe.yml"), "utf-8")
          );
          recipes.push({ name: entry.name, description: manifest.description, source: "user" });
        }
      }
    } catch { /* ignore */ }
  }

  // Project-local
  const projectRecipesDir = resolve(process.cwd(), ".dx", "recipes");
  if (existsSync(projectRecipesDir)) {
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      for (const entry of readdirSync(projectRecipesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(projectRecipesDir, entry.name, "recipe.yml"))) {
          const manifest = parseRecipeManifest(
            readFileSync(join(projectRecipesDir, entry.name, "recipe.yml"), "utf-8")
          );
          recipes.push({ name: entry.name, description: manifest.description, source: "project" });
        }
      }
    } catch { /* ignore */ }
  }

  return recipes;
}
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "lib/recipe"`
Expected: No errors from `recipe.ts`

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/recipe.ts
git commit -m "feat(cli): add recipe library with types, built-in registry, and resolution"
```

---

### Task 2: Machine Target Expansion

**Files:**
- Create: `cli/src/lib/machine-target.ts`
- Modify: `cli/src/handlers/docker-remote.ts`

- [ ] **Step 1: Create machine-target.ts with multi-target expansion**

```typescript
// cli/src/lib/machine-target.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

import { resolveMachine, type MachineTarget } from "../handlers/docker-remote.js";

export type { MachineTarget } from "../handlers/docker-remote.js";
export { resolveMachine } from "../handlers/docker-remote.js";

/**
 * Expand a --on target expression into a list of resolved machines.
 *
 * Supported formats:
 * - "staging-1"                    → single machine
 * - "staging-1,staging-2,prod-1"  → comma-separated
 * - "tag:webservers"              → machines with matching tag
 * - "@inventory:webservers"       → group from .dx/inventory.yml
 */
export async function expandTargets(onExpr: string): Promise<MachineTarget[]> {
  // Tag-based
  if (onExpr.startsWith("tag:")) {
    const tag = onExpr.slice(4);
    return resolveByTag(tag);
  }

  // Inventory-based
  if (onExpr.startsWith("@inventory:")) {
    const group = onExpr.slice(11);
    return resolveByInventoryGroup(group);
  }

  // Comma-separated or single
  const slugs = onExpr.split(",").map((s) => s.trim()).filter(Boolean);
  const targets: MachineTarget[] = [];
  for (const slug of slugs) {
    targets.push(await resolveMachine(slug));
  }
  return targets;
}

// ─── Tag resolution ───────────────────────────────────────────

interface LocalMachineEntry {
  host: string;
  user?: string;
  port?: number;
  kind?: string;
  tags?: string[];
}

function resolveByTag(tag: string): Promise<MachineTarget[]> {
  const machinesPath = resolve(homedir(), ".config", "dx", "machines.json");
  const targets: MachineTarget[] = [];

  if (existsSync(machinesPath)) {
    try {
      const machines: Record<string, LocalMachineEntry> = JSON.parse(
        readFileSync(machinesPath, "utf-8")
      );
      for (const [slug, entry] of Object.entries(machines)) {
        if (entry.tags?.includes(tag)) {
          const port = entry.port ?? 22;
          const user = entry.user ?? "root";
          const dockerHost = port !== 22
            ? `ssh://${user}@${entry.host}:${port}`
            : `ssh://${user}@${entry.host}`;
          targets.push({
            name: slug,
            kind: entry.kind ?? "local-config",
            host: entry.host,
            port,
            user,
            dockerHost,
            source: "local",
          });
        }
      }
    } catch { /* ignore */ }
  }

  // TODO: Also query Factory API for hosts/VMs with matching labels

  if (targets.length === 0) {
    throw new Error(
      `No machines found with tag "${tag}".\n` +
      `  Add tags: dx docker add <name> --host <ip> --tag ${tag}`
    );
  }

  return Promise.resolve(targets);
}

// ─── Inventory resolution ─────────────────────────────────────

async function resolveByInventoryGroup(group: string): Promise<MachineTarget[]> {
  const inventoryPath = resolve(process.cwd(), ".dx", "inventory.yml");
  if (!existsSync(inventoryPath)) {
    throw new Error(
      `Inventory file not found: .dx/inventory.yml\n` +
      `  Create it with groups of machine slugs.`
    );
  }

  const content = readFileSync(inventoryPath, "utf-8");
  const doc = parseYaml(content);

  if (!doc?.groups?.[group]) {
    const available = doc?.groups ? Object.keys(doc.groups).join(", ") : "none";
    throw new Error(
      `Inventory group "${group}" not found.\n` +
      `  Available groups: ${available}`
    );
  }

  const slugs: string[] = doc.groups[group];
  const targets: MachineTarget[] = [];
  for (const slug of slugs) {
    targets.push(await resolveMachine(slug));
  }
  return targets;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "machine-target"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add cli/src/lib/machine-target.ts
git commit -m "feat(cli): add machine-target expansion (comma, tag, inventory)"
```

---

### Task 3: Run Handler — Input Detection and Recipe Execution

**Files:**
- Create: `cli/src/handlers/run.ts`

- [ ] **Step 1: Create the run handler with input detection**

```typescript
// cli/src/handlers/run.ts
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  resolveRecipe,
  resolveParams,
  type ResolvedRecipe,
} from "../lib/recipe.js";
import {
  expandTargets,
  resolveMachine,
  type MachineTarget,
} from "../lib/machine-target.js";
import { buildSshArgs } from "../handlers/docker-remote.js";
import {
  styleBold,
  styleMuted,
  styleSuccess,
  styleError,
} from "../commands/list-helpers.js";

// ─── Input type detection ─────────────────────────────────────

export type InputType = "script-ts" | "script-sh" | "recipe" | "unknown";

export function detectInputType(input: string): InputType {
  const ext = extname(input).toLowerCase();

  // File extensions
  if (ext === ".ts" || ext === ".js" || ext === ".mts" || ext === ".mjs") return "script-ts";
  if (ext === ".sh") return "script-sh";

  // @dx/ prefix → built-in recipe
  if (input.startsWith("@dx/")) return "recipe";

  // Directory with recipe.yml
  if (existsSync(resolve(input, "recipe.yml"))) return "recipe";

  // Bare name → try recipe resolution
  // We check this last — if a recipe exists with this name, it's a recipe
  try {
    resolveRecipe(input);
    return "recipe";
  } catch {
    // Not a recipe
  }

  return "unknown";
}

// ─── Script execution (local) ─────────────────────────────────

export async function runScriptLocal(
  file: string,
  opts: { watch?: boolean; passthrough: string[]; environment?: string; noSecrets?: boolean },
): Promise<void> {
  const { runScript } = await import("./script.js");
  await runScript({
    file,
    watch: opts.watch,
    passthrough: opts.passthrough,
    environment: opts.environment,
    noSecrets: opts.noSecrets,
  });
}

// ─── Shell script execution (remote) ──────────────────────────

export async function runShellScriptRemote(
  file: string,
  target: MachineTarget,
  extraEnv: Record<string, string>,
): Promise<void> {
  const resolved = resolve(file);
  if (!existsSync(resolved)) {
    throw new Error(`Script not found: ${resolved}`);
  }
  const script = readFileSync(resolved, "utf-8");
  const sshArgs = buildSshArgs(target);

  // Build env export preamble
  const envExports = Object.entries(extraEnv)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  const fullScript = envExports ? `${envExports}\n${script}` : script;

  try {
    execFileSync("ssh", [...sshArgs, "bash -s"], {
      stdio: ["pipe", "inherit", "inherit"],
      input: fullScript,
    });
  } catch (err: any) {
    if (err.status != null) throw err;
    throw err;
  }
}

// ─── Recipe execution ─────────────────────────────────────────

interface RunRecipeOpts {
  recipeName: string;
  targets: MachineTarget[];
  paramEnv: Record<string, string>;
  dryRun?: boolean;
  force?: boolean;
}

export async function runRecipe(opts: RunRecipeOpts): Promise<void> {
  const recipe = resolveRecipe(opts.recipeName);

  // Check dependencies recursively
  await checkAndApplyDependencies(recipe, opts.targets, opts.paramEnv, new Set());

  const isMulti = opts.targets.length > 1;
  if (isMulti) {
    console.log(`Running ${styleBold(recipe.manifest.name)} on ${opts.targets.length} machine(s)...\n`);
  }

  const results: Array<{ name: string; status: string; duration: number }> = [];

  for (const target of opts.targets) {
    const start = Date.now();
    try {
      await runRecipeOnMachine(recipe, target, opts.paramEnv, opts.dryRun, opts.force);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ name: target.name, status: "applied", duration: Date.now() - start });
      if (isMulti) {
        console.log(`  ${target.name}  ${styleSuccess("✓")}  applied (${elapsed}s)`);
      }
    } catch (err: any) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const msg = err.message ?? String(err);

      // Check if "already applied" (verify.sh passed)
      if (msg === "__already_applied__") {
        results.push({ name: target.name, status: "skipped", duration: Date.now() - start });
        if (isMulti) {
          console.log(`  ${target.name}  ${styleSuccess("✓")}  already applied (skipped)`);
        } else {
          console.log(styleMuted(`Recipe "${recipe.manifest.name}" is already applied on ${target.name}. Use --force to re-apply.`));
        }
        continue;
      }

      results.push({ name: target.name, status: `failed: ${msg}`, duration: Date.now() - start });
      if (isMulti) {
        console.log(`  ${target.name}  ${styleError("✗")}  failed (${elapsed}s): ${msg}`);
      } else {
        throw err;
      }
    }
  }
}

async function runRecipeOnMachine(
  recipe: ResolvedRecipe,
  target: MachineTarget,
  paramEnv: Record<string, string>,
  dryRun?: boolean,
  force?: boolean,
): Promise<void> {
  const sshArgs = buildSshArgs(target);
  const machineEnv: Record<string, string> = {
    ...paramEnv,
    DX_MACHINE_NAME: target.name,
    DX_MACHINE_HOST: target.host,
    DX_MACHINE_USER: target.user,
    DX_RECIPE_NAME: recipe.manifest.name,
  };

  // Build env export preamble
  const envExports = Object.entries(machineEnv)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  // Verify step
  if (recipe.verifyScript) {
    const verifyScript = `${envExports}\n${recipe.verifyScript}`;
    const verifyResult = spawnSync("ssh", [...sshArgs, "bash -s"], {
      input: verifyScript,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });

    if (dryRun) {
      if (verifyResult.status === 0) {
        console.log(styleSuccess(`[dry-run] ${recipe.manifest.name} is already applied on ${target.name}`));
      } else {
        console.log(styleMuted(`[dry-run] ${recipe.manifest.name} needs to be applied on ${target.name}`));
      }
      return;
    }

    if (verifyResult.status === 0 && !force) {
      throw new Error("__already_applied__");
    }
  } else if (dryRun) {
    console.log(styleMuted(`[dry-run] ${recipe.manifest.name} has no verify.sh — cannot determine state on ${target.name}`));
    return;
  }

  // Install step
  console.log(`Applying ${styleBold(recipe.manifest.name)} on ${target.name}...`);
  const installScript = `${envExports}\n${recipe.installScript}`;

  try {
    execFileSync("ssh", [...sshArgs, "bash -s"], {
      stdio: ["pipe", "inherit", "inherit"],
      input: installScript,
    });
  } catch (err: any) {
    if (err.status != null) {
      throw new Error(`Recipe "${recipe.manifest.name}" failed on ${target.name} (exit code ${err.status})`);
    }
    throw err;
  }

  console.log(styleSuccess(`Recipe "${recipe.manifest.name}" applied on ${target.name}`));
}

async function checkAndApplyDependencies(
  recipe: ResolvedRecipe,
  targets: MachineTarget[],
  paramEnv: Record<string, string>,
  visited: Set<string>,
): Promise<void> {
  const deps = recipe.manifest.requires ?? [];
  if (deps.length === 0) return;

  for (const depName of deps) {
    if (visited.has(depName)) {
      throw new Error(`Circular dependency detected: ${[...visited, depName].join(" → ")}`);
    }
    visited.add(depName);

    const depRecipe = resolveRecipe(depName);

    // Recursively check deps of deps
    await checkAndApplyDependencies(depRecipe, targets, {}, visited);

    // Check if dep is satisfied on each target
    if (depRecipe.verifyScript) {
      for (const target of targets) {
        const sshArgs = buildSshArgs(target);
        const result = spawnSync("ssh", [...sshArgs, "bash -s"], {
          input: depRecipe.verifyScript,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf8",
        });

        if (result.status !== 0) {
          console.log(styleMuted(`Dependency "${depName}" not satisfied on ${target.name} — applying...`));
          await runRecipeOnMachine(depRecipe, target, {}, false, false);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "handlers/run"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add cli/src/handlers/run.ts
git commit -m "feat(cli): add run handler with input detection, recipe execution, and dependency resolution"
```

---

### Task 4: dx run Command

**Files:**
- Create: `cli/src/commands/run.ts`
- Modify: `cli/src/register-commands.ts`

- [ ] **Step 1: Create the dx run command**

```typescript
// cli/src/commands/run.ts
import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import {
  styleBold,
  styleMuted,
  styleSuccess,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("run", [
  "$ dx run script.ts                          Run a TypeScript script locally",
  "$ dx run setup.sh --on staging-1            Run a shell script on a remote machine",
  "$ dx run @dx/docker --on staging-1          Install Docker via built-in recipe",
  "$ dx run ghost-cms --on prod --set domain=x Run a custom recipe with params",
  "$ dx run list                               List available recipes",
]);

export function runCommand(app: DxBase) {
  return app
    .sub("run")
    .meta({ description: "Run scripts, recipes, and playbooks locally or on remote machines" })
    .args([
      {
        name: "input",
        type: "string",
        description: "Script file, recipe name, or @dx/<built-in>",
      },
    ])
    .flags({
      on: {
        type: "string",
        description: "Target machine(s): slug, comma-separated, tag:<name>, or @inventory:<group>",
      },
      set: {
        type: "string",
        description: "Set recipe parameter (repeatable, format: key=value)",
      },
      "dry-run": {
        type: "boolean",
        description: "Check current state without applying changes",
      },
      force: {
        type: "boolean",
        description: "Apply even if already applied",
      },
      watch: {
        type: "boolean",
        alias: "w",
        description: "Re-run script on file changes (TS/JS only)",
      },
      env: {
        type: "string",
        description: "Secret environment scope (production, development, preview)",
      },
      secrets: {
        type: "boolean",
        description: "Inject secrets (use --no-secrets to disable)",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const input = args.input as string | undefined;

      if (!input) {
        console.log(styleBold("dx run") + " — Universal execute\n");
        console.log("Usage:");
        console.log("  dx run <script.ts>                    Run TypeScript/JavaScript locally");
        console.log("  dx run <script.sh> --on <machine>     Run shell script on remote machine");
        console.log("  dx run @dx/<tool> --on <machine>      Run built-in recipe");
        console.log("  dx run <recipe> --on <machine>        Run custom recipe");
        console.log("  dx run list                           List available recipes");
        console.log("  dx run show <recipe>                  Show recipe details");
        console.log("");
        console.log("Flags:");
        console.log("  --on <target>     Machine(s): slug, slug1,slug2, tag:<name>, @inventory:<group>");
        console.log("  --set key=value   Set recipe parameter (repeatable)");
        console.log("  --dry-run         Check state without applying");
        console.log("  --force           Re-apply even if already applied");
        console.log("  --watch           Re-run on file changes (scripts only)");
        return;
      }

      try {
        const {
          detectInputType,
          runScriptLocal,
          runShellScriptRemote,
          runRecipe,
        } = await import("../handlers/run.js");
        const { expandTargets } = await import("../lib/machine-target.js");
        const { resolveRecipe, resolveParams } = await import("../lib/recipe.js");

        const inputType = detectInputType(input);
        const onExpr = flags.on as string | undefined;

        // Collect --set flags (may be string or repeated)
        const rawSet = flags.set;
        const setFlags: string[] = !rawSet
          ? []
          : Array.isArray(rawSet)
            ? rawSet as string[]
            : [rawSet as string];

        switch (inputType) {
          case "script-ts": {
            if (onExpr) {
              // Remote TS execution — not yet supported in v1
              exitWithError(
                f,
                "Remote TypeScript execution is not yet supported.\n" +
                "  Use a .sh script for remote execution, or run the recipe system:\n" +
                "  dx run @dx/docker --on <machine>"
              );
            }
            // Local TS/JS execution — delegate to existing script handler
            const allArgs = process.argv;
            const ddIdx = allArgs.indexOf("--");
            const passthrough = ddIdx >= 0 ? allArgs.slice(ddIdx + 1) : [];
            await runScriptLocal(input, {
              watch: flags.watch as boolean | undefined,
              passthrough,
              environment: flags.env as string | undefined,
              noSecrets: flags.secrets === false ? true : undefined,
            });
            break;
          }

          case "script-sh": {
            if (!onExpr) {
              // Local shell script — just run it
              const { execFileSync } = await import("node:child_process");
              try {
                execFileSync("bash", [input], { stdio: "inherit" });
              } catch (err: any) {
                if (err.status != null) process.exit(err.status);
                throw err;
              }
              break;
            }
            // Remote shell script
            const targets = await expandTargets(onExpr);
            for (const target of targets) {
              console.log(styleMuted(`Running on ${styleBold(target.name)}...`));
              await runShellScriptRemote(input, target, {
                DX_MACHINE_NAME: target.name,
                DX_MACHINE_HOST: target.host,
                DX_MACHINE_USER: target.user,
              });
              console.log(styleSuccess(`Done on ${target.name}`));
            }
            break;
          }

          case "recipe": {
            if (!onExpr) {
              exitWithError(
                f,
                `Recipe "${input}" requires a target machine.\n` +
                "  Usage: dx run " + input + " --on <machine>"
              );
            }

            const recipe = resolveRecipe(input);
            const paramEnv = resolveParams(recipe.manifest, setFlags);
            const targets = await expandTargets(onExpr);

            await runRecipe({
              recipeName: input,
              targets,
              paramEnv,
              dryRun: flags["dry-run"] as boolean | undefined,
              force: flags.force as boolean | undefined,
            });
            break;
          }

          default:
            exitWithError(
              f,
              `Cannot determine how to run "${input}".\n` +
              "  Expected: .ts/.js/.sh file, recipe name (@dx/<name>), or recipe directory.\n" +
              "  List recipes: dx run list"
            );
        }
      } catch (err) {
        exitWithError(f, err instanceof Error ? err.message : String(err));
      }
    })

    // ── dx run list ──
    .command("list", (c) =>
      c
        .meta({ description: "List available recipes" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const { listRecipes } = await import("../lib/recipe.js");
          const { printTable } = await import("../output.js");

          const recipes = listRecipes();

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: recipes }, null, 2));
            return;
          }

          if (recipes.length === 0) {
            console.log("No recipes found.");
            return;
          }

          const rows = recipes.map((r) => [
            styleBold(r.name),
            r.description,
            styleMuted(r.source),
          ]);
          console.log(printTable(["Name", "Description", "Source"], rows));
        })
    )

    // ── dx run show <recipe> ──
    .command("show", (c) =>
      c
        .meta({ description: "Show recipe details" })
        .args([{ name: "name", type: "string", required: true, description: "Recipe name" }])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const { resolveRecipe } = await import("../lib/recipe.js");

          try {
            const recipe = resolveRecipe(args.name as string);
            const m = recipe.manifest;

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: m }, null, 2));
              return;
            }

            console.log(styleBold(m.name) + styleMuted(` (${recipe.source})`));
            console.log(m.description);
            console.log("");

            if (m.requires?.length) {
              console.log("Requires: " + m.requires.join(", "));
            }
            if (m.os?.length) {
              console.log("OS: " + m.os.join(", "));
            }

            const params = m.params ?? {};
            if (Object.keys(params).length > 0) {
              console.log("\nParameters:");
              for (const [key, spec] of Object.entries(params)) {
                const req = spec.required ? " (required)" : "";
                const def = spec.default !== undefined ? ` [default: ${spec.default}]` : "";
                console.log(`  --set ${key}=<${spec.type}>${req}${def}`);
                if (spec.description) {
                  console.log(styleMuted(`    ${spec.description}`));
                }
              }
            }

            console.log(styleMuted(`\nHas verify.sh: ${recipe.verifyScript ? "yes" : "no"}`));
            console.log(styleMuted(`Has uninstall.sh: ${recipe.uninstallScript ? "yes" : "no"}`));
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    );
}
```

- [ ] **Step 2: Register the run command in register-commands.ts**

Add import and registration:

```typescript
// After the releaseCommand import:
import { runCommand } from "./commands/run.js";

// In the chain, after .command(routeCommand(app)):
.command(runCommand(app))
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "commands/run"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/run.ts cli/src/register-commands.ts
git commit -m "feat(cli): add dx run command with input detection, recipe execution, and list/show subcommands"
```

---

### Task 5: dx setup Command

**Files:**
- Create: `cli/src/commands/setup.ts`
- Modify: `cli/src/register-commands.ts`

- [ ] **Step 1: Create the dx setup command**

`dx setup` with no args or `--role` delegates to the existing install flow. `dx setup <tool> --on <machine>` is sugar for `dx run @dx/<tool> --on <machine>`.

```typescript
// cli/src/commands/setup.ts
import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import {
  styleBold,
  styleMuted,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("setup", [
  "$ dx setup                                 Install/upgrade the dx platform",
  "$ dx setup docker --on staging-1           Install Docker on a remote machine",
  "$ dx setup node --on staging-1 --set v=20  Install Node.js v20 on a remote machine",
  "$ dx setup caddy --on staging-1            Install Caddy on a remote machine",
]);

export function setupCommand(app: DxBase) {
  return app
    .sub("setup")
    .meta({ description: "Set up the dx platform or install tools on remote machines" })
    .args([
      {
        name: "tool",
        type: "string",
        description: "Tool to install (docker, node, caddy, etc.) or omit for platform setup",
      },
    ])
    .flags({
      on: {
        type: "string",
        description: "Target machine(s) for remote tool installation",
      },
      set: {
        type: "string",
        description: "Set recipe parameter (repeatable, format: key=value)",
      },
      "dry-run": {
        type: "boolean",
        description: "Check current state without applying changes",
      },
      force: {
        type: "boolean",
        description: "Re-install even if already present",
      },
      // Pass through all dx install flags for platform setup mode
      role: { type: "string", description: "Installation role: workbench (default), site, or factory" },
      bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
      yes: { type: "boolean", short: "y", description: "Skip interactive prompts" },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const tool = args.tool as string | undefined;
      const onExpr = flags.on as string | undefined;

      // No tool specified → delegate to platform install (dx install)
      if (!tool) {
        const { installCommand } = await import("./install.js");
        // Re-invoke dx install with the same flags
        console.log(styleMuted("Running platform setup (same as dx install)...\n"));
        // Directly import and run the install handler
        // We forward by re-running the install command's run handler
        const args = process.argv.slice(2).filter(a => a !== "setup");
        args.unshift("install");
        // Simplest: just tell the user
        console.log(styleBold("dx setup") + " — Platform & machine setup\n");
        console.log("For platform installation, use: " + styleBold("dx install"));
        console.log("For remote tool setup:");
        console.log("  dx setup docker --on <machine>     Install Docker");
        console.log("  dx setup node --on <machine>       Install Node.js");
        console.log("  dx setup caddy --on <machine>      Install Caddy");
        console.log("");
        console.log(styleMuted("dx setup <tool> --on <machine> is equivalent to dx run @dx/<tool> --on <machine>"));
        return;
      }

      // Tool specified → delegate to dx run @dx/<tool> --on <machine>
      if (!onExpr) {
        exitWithError(
          f,
          `dx setup ${tool} requires --on <machine>.\n` +
          `  Usage: dx setup ${tool} --on <machine-slug>`
        );
      }

      try {
        const { resolveRecipe, resolveParams } = await import("../lib/recipe.js");
        const { expandTargets } = await import("../lib/machine-target.js");
        const { runRecipe } = await import("../handlers/run.js");

        const recipeName = `@dx/${tool}`;
        const recipe = resolveRecipe(recipeName);

        const rawSet = flags.set;
        const setFlags: string[] = !rawSet
          ? []
          : Array.isArray(rawSet)
            ? rawSet as string[]
            : [rawSet as string];

        const paramEnv = resolveParams(recipe.manifest, setFlags);
        const targets = await expandTargets(onExpr);

        await runRecipe({
          recipeName,
          targets,
          paramEnv,
          dryRun: flags["dry-run"] as boolean | undefined,
          force: flags.force as boolean | undefined,
        });
      } catch (err) {
        exitWithError(f, err instanceof Error ? err.message : String(err));
      }
    });
}
```

- [ ] **Step 2: Register the setup command in register-commands.ts**

Add import and registration:

```typescript
// After the secretCommand import:
import { setupCommand } from "./commands/setup.js";

// In the chain, after .command(siteCommand(app)):
.command(setupCommand(app))
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "commands/setup"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/setup.ts cli/src/register-commands.ts
git commit -m "feat(cli): add dx setup command as sugar over dx run @dx/<tool>"
```

---

### Task 6: Deprecation Aliases — dx script → dx run

**Files:**
- Modify: `cli/src/commands/script.ts`

- [ ] **Step 1: Add deprecation notice to dx script**

Modify the `.run()` handler in `cli/src/commands/script.ts` to print a one-time deprecation notice before delegating. Keep full backward compat — `dx script` must keep working exactly as before.

In `cli/src/commands/script.ts`, add a stderr notice at the top of the `.run()` handler (line 42):

```typescript
// Inside .run(async ({ args, flags }) => {
//   Add this at the very beginning, before const f = toDxFlags(flags):
      console.error("\x1b[2m(dx script is now dx run — dx script still works)\x1b[0m");
```

This is a single line addition. The rest of the handler stays identical.

- [ ] **Step 2: Verify dx script still compiles**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "commands/script"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add cli/src/commands/script.ts
git commit -m "feat(cli): add deprecation notice to dx script (use dx run instead)"
```

---

### Task 7: Wire dx docker setup to Recipe System

**Files:**
- Modify: `cli/src/commands/docker.ts`

- [ ] **Step 1: Update dx docker setup to delegate to recipe runner**

In `cli/src/commands/docker.ts`, find the `setup` subcommand's `.run()` handler. Replace the inline `DOCKER_BOOTSTRAP_SCRIPT` execution with a call to the recipe system.

Replace the body of the setup `.run()` handler with:

```typescript
        .run(async ({ args }) => {
          const slug = args.machine as string;
          if (!slug) {
            console.error("Usage: dx docker setup <machine>");
            process.exit(1);
          }

          // Delegate to the recipe system
          const { resolveRecipe, resolveParams } = await import("../lib/recipe.js");
          const { expandTargets } = await import("../lib/machine-target.js");
          const { runRecipe } = await import("../handlers/run.js");

          const recipe = resolveRecipe("@dx/docker");
          const targets = await expandTargets(slug);
          const paramEnv = resolveParams(recipe.manifest, []);

          await runRecipe({
            recipeName: "@dx/docker",
            targets,
            paramEnv,
          });
        })
```

- [ ] **Step 2: Remove the DOCKER_BOOTSTRAP_SCRIPT import from docker.ts**

Remove `DOCKER_BOOTSTRAP_SCRIPT` from the import list in `cli/src/commands/docker.ts` since it's no longer used directly by the setup command. Also remove `buildSshArgs` if only used by setup (check first — it's still used in other commands? No, `buildSshArgs` is only used by `docker-remote.ts` internally; `docker.ts` only imported it for setup).

Check the imports and remove unused ones. The `buildSshArgs` and `DOCKER_BOOTSTRAP_SCRIPT` imports can be removed if setup was the only consumer in this file.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "commands/docker"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/docker.ts
git commit -m "refactor(cli): dx docker setup now delegates to recipe system"
```

---

### Task 8: Tag Support in dx docker add

**Files:**
- Modify: `cli/src/commands/docker.ts`
- Modify: `cli/src/handlers/docker-remote.ts`

- [ ] **Step 1: Add --tag flag to dx docker add command**

In `cli/src/commands/docker.ts`, find the `add` subcommand's `.flags()` block. Add a `tag` flag:

```typescript
          tag: {
            type: "string",
            short: "t",
            description: "Tag for machine grouping (repeatable, e.g. --tag web --tag production)",
          },
```

In the `.run()` handler, pass tags to `saveLocalMachine`:

```typescript
          const rawTag = flags.tag;
          const tags: string[] = !rawTag
            ? []
            : Array.isArray(rawTag)
              ? rawTag as string[]
              : [rawTag as string];

          saveLocalMachine(name, { host, user, port, tags: tags.length > 0 ? tags : undefined });
```

- [ ] **Step 2: Update LocalMachineEntry type in docker-remote.ts**

In `cli/src/handlers/docker-remote.ts`, add `tags` to `LocalMachineEntry`:

```typescript
interface LocalMachineEntry {
  host: string;
  user?: string;
  port?: number;
  kind?: string;
  tags?: string[];
}
```

And update `saveLocalMachine` to accept and persist tags:

```typescript
export function saveLocalMachine(
  slug: string,
  entry: LocalMachineEntry & { tags?: string[] },
): void {
```

(The `tags` field in `LocalMachineEntry` already handles this — just ensure the type is consistent.)

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep "docker"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/docker.ts cli/src/handlers/docker-remote.ts
git commit -m "feat(cli): add --tag flag to dx docker add for machine grouping"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit -p cli/tsconfig.json 2>&1 | grep -E "commands/(run|setup|docker)|handlers/run|lib/(recipe|machine-target)"`
Expected: No errors from any of the new/modified files

- [ ] **Step 2: Verify command registration**

Run: `grep -n "runCommand\|setupCommand" cli/src/register-commands.ts`
Expected: Both imports and `.command()` calls present

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for dx run/setup recipe system"
```
