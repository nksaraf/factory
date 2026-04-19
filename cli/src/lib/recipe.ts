// cli/src/lib/recipe.ts
import { existsSync, readFileSync } from "node:fs"
import { DX_DATA_DIR } from "./host-dirs.js"
import { join, resolve } from "node:path"
import { parse as parseYaml } from "yaml"

// ─── Types ────────────────────────────────────────────────────

export interface RecipeParam {
  type: "string" | "number" | "boolean"
  required?: boolean
  default?: string | number | boolean
  description?: string
}

export interface RecipeManifest {
  name: string
  description: string
  requires?: string[]
  params?: Record<string, RecipeParam>
  os?: string[]
  tags?: string[]
}

export interface ResolvedRecipe {
  manifest: RecipeManifest
  /** The install script content */
  installScript: string
  /** The verify script content (optional) */
  verifyScript?: string
  /** The uninstall script content (optional) */
  uninstallScript?: string
  /** Where this recipe was resolved from */
  source: "project" | "user" | "builtin"
}

// ─── Manifest parsing ─────────────────────────────────────────

export function parseRecipeManifest(yamlContent: string): RecipeManifest {
  const doc = parseYaml(yamlContent)
  if (!doc?.name || !doc?.description) {
    throw new Error("recipe.yml must have 'name' and 'description' fields")
  }
  return {
    name: doc.name,
    description: doc.description,
    requires: doc.requires ?? [],
    params: doc.params ?? {},
    os: doc.os,
    tags: doc.tags ?? [],
  }
}

function loadRecipeFromDir(
  dir: string,
  source: ResolvedRecipe["source"]
): ResolvedRecipe | null {
  const manifestPath = join(dir, "recipe.yml")
  if (!existsSync(manifestPath)) return null

  const manifest = parseRecipeManifest(readFileSync(manifestPath, "utf-8"))

  const installPath = join(dir, "install.sh")
  if (!existsSync(installPath)) {
    throw new Error(`Recipe "${manifest.name}" is missing install.sh`)
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
  }
}

// ─── Built-in recipes (embedded) ──────────────────────────────

const BUILTIN_DOCKER_MANIFEST: RecipeManifest = {
  name: "docker",
  description: "Install Docker Engine and Docker Compose plugin",
  params: {
    version: {
      type: "string",
      description: "Docker version (default: latest)",
    },
  },
  os: ["linux"],
  tags: ["container", "runtime"],
}

const BUILTIN_DOCKER_INSTALL = `#!/bin/bash
set -euo pipefail

echo "==> Detecting OS..."
IS_ALPINE=false
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "    OS: $NAME \${VERSION_ID:-unknown}"
  if [ "\${ID:-}" = "alpine" ]; then
    IS_ALPINE=true
  fi
else
  echo "    Could not detect OS. Attempting install anyway."
fi

if [ "$IS_ALPINE" = true ]; then
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
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" != "root" ]; then
  if command -v sudo &>/dev/null; then
    sudo usermod -aG docker "$CURRENT_USER" 2>/dev/null || adduser "$CURRENT_USER" docker 2>/dev/null || true
  else
    adduser "$CURRENT_USER" docker 2>/dev/null || true
  fi
  echo "    Added $CURRENT_USER to docker group."
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
`

const BUILTIN_DOCKER_VERIFY = `#!/bin/bash
command -v docker &>/dev/null && docker info &>/dev/null
`

const BUILTIN_NODE_MANIFEST: RecipeManifest = {
  name: "node",
  description: "Install Node.js via nvm",
  params: {
    version: {
      type: "string",
      default: "22",
      description: "Node.js major version",
    },
  },
  os: ["linux"],
  tags: ["runtime", "javascript"],
}

const BUILTIN_NODE_INSTALL = `#!/bin/bash
set -euo pipefail
VERSION="\${DX_PARAM_VERSION:-22}"

echo "==> Installing nvm..."
export NVM_DIR="$HOME/.nvm"
if [ ! -d "$NVM_DIR" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

# Source nvm
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "==> Installing Node.js v$VERSION..."
nvm install "$VERSION"
nvm alias default "$VERSION"

echo "==> Verifying..."
node --version
npm --version

echo "==> Node.js setup complete!"
`

const BUILTIN_NODE_VERIFY = `#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
VERSION="\${DX_PARAM_VERSION:-22}"
node --version 2>/dev/null | grep -q "v$VERSION"
`

const BUILTIN_CADDY_MANIFEST: RecipeManifest = {
  name: "caddy",
  description: "Install Caddy web server",
  requires: ["docker"],
  params: {
    domain: { type: "string", description: "Domain for automatic HTTPS" },
  },
  os: ["linux"],
  tags: ["webserver", "proxy", "https"],
}

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
`

const BUILTIN_CADDY_VERIFY = `#!/bin/bash
command -v caddy &>/dev/null && caddy version &>/dev/null
`

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
}

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
    const builtinName = name.slice(4)
    const recipe = BUILTIN_RECIPES[builtinName]
    if (!recipe) {
      throw new Error(
        `Built-in recipe "${builtinName}" not found. Available: ${Object.keys(BUILTIN_RECIPES).join(", ")}`
      )
    }
    return recipe
  }

  // 1. Project-local: .dx/recipes/<name>/
  const projectDir = resolve(process.cwd(), ".dx", "recipes", name)
  const projectRecipe = loadRecipeFromDir(projectDir, "project")
  if (projectRecipe) return projectRecipe

  // 2. User-global: ~/.config/dx/recipes/<name>/
  const userDir = resolve(DX_DATA_DIR, "recipes", name)
  const userRecipe = loadRecipeFromDir(userDir, "user")
  if (userRecipe) return userRecipe

  // 3. Built-in
  const builtin = BUILTIN_RECIPES[name]
  if (builtin) return builtin

  throw new Error(
    `Recipe "${name}" not found.\n` +
      `  Searched: .dx/recipes/, ~/.config/dx/recipes/, built-in\n` +
      `  Available built-in recipes: ${Object.keys(BUILTIN_RECIPES).join(", ")}\n` +
      `  List all: dx run list`
  )
}

/**
 * Validate and resolve parameters against a recipe manifest.
 * Returns the full param env map (DX_PARAM_KEY=value).
 */
export function resolveParams(
  manifest: RecipeManifest,
  setFlags: string[]
): Record<string, string> {
  const env: Record<string, string> = {}
  const provided = new Map<string, string>()

  // Parse --set key=value flags
  for (const s of setFlags) {
    const eqIdx = s.indexOf("=")
    if (eqIdx < 0) {
      throw new Error(`Invalid --set format: "${s}". Expected: --set key=value`)
    }
    provided.set(s.slice(0, eqIdx), s.slice(eqIdx + 1))
  }

  const params = manifest.params ?? {}

  // Validate and build env
  for (const [key, spec] of Object.entries(params)) {
    const value = provided.get(key)
    const envKey = `DX_PARAM_${key.toUpperCase()}`

    if (value !== undefined) {
      // Validate type
      if (spec.type === "number" && isNaN(Number(value))) {
        throw new Error(`Parameter "${key}" must be a number, got "${value}"`)
      }
      if (spec.type === "boolean" && value !== "true" && value !== "false") {
        throw new Error(`Parameter "${key}" must be true/false, got "${value}"`)
      }
      env[envKey] = value
      provided.delete(key)
    } else if (spec.default !== undefined) {
      env[envKey] = String(spec.default)
    } else if (spec.required) {
      throw new Error(
        `Missing required parameter "${key}". Use: --set ${key}=<value>\n` +
          (spec.description ? `  ${key}: ${spec.description}` : "")
      )
    }
  }

  // Warn about unknown params
  for (const [key] of provided) {
    if (!params[key]) {
      const known = Object.keys(params).join(", ")
      console.warn(
        `Warning: Unknown parameter "${key}" (ignored). Known: ${known}`
      )
    }
  }

  return env
}

/**
 * List all available recipes (built-in + user + project).
 */
export function listRecipes(): Array<{
  name: string
  description: string
  source: string
}> {
  const recipes: Array<{ name: string; description: string; source: string }> =
    []

  // Built-in
  for (const [name, recipe] of Object.entries(BUILTIN_RECIPES)) {
    recipes.push({
      name: `@dx/${name}`,
      description: recipe.manifest.description,
      source: "built-in",
    })
  }

  // User-global
  const userRecipesDir = resolve(DX_DATA_DIR, "recipes")
  if (existsSync(userRecipesDir)) {
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs")
      for (const entry of readdirSync(userRecipesDir, {
        withFileTypes: true,
      })) {
        if (
          entry.isDirectory() &&
          existsSync(join(userRecipesDir, entry.name, "recipe.yml"))
        ) {
          const manifest = parseRecipeManifest(
            readFileSync(
              join(userRecipesDir, entry.name, "recipe.yml"),
              "utf-8"
            )
          )
          recipes.push({
            name: entry.name,
            description: manifest.description,
            source: "user",
          })
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Project-local
  const projectRecipesDir = resolve(process.cwd(), ".dx", "recipes")
  if (existsSync(projectRecipesDir)) {
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs")
      for (const entry of readdirSync(projectRecipesDir, {
        withFileTypes: true,
      })) {
        if (
          entry.isDirectory() &&
          existsSync(join(projectRecipesDir, entry.name, "recipe.yml"))
        ) {
          const manifest = parseRecipeManifest(
            readFileSync(
              join(projectRecipesDir, entry.name, "recipe.yml"),
              "utf-8"
            )
          )
          recipes.push({
            name: entry.name,
            description: manifest.description,
            source: "project",
          })
        }
      }
    } catch {
      /* ignore */
    }
  }

  return recipes
}
