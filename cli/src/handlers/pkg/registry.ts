/**
 * GCP Artifact Registry configuration and helpers.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../lib/subprocess.js"

export const GCP_PROJECT = "rio-platform"

export const REGISTRIES: Record<
  string,
  {
    envVar: string
    repo: string
    location: string
    host: string
    label: string
    url: string
  }
> = {
  maven: {
    envVar: "GCP_MAVEN_SA_JSON_BASE64",
    repo: "maven-repo",
    location: "asia-south1",
    host: "asia-south1-maven.pkg.dev",
    label: "Maven registry",
    url: "asia-south1-maven.pkg.dev/rio-platform/maven-repo",
  },
  npm: {
    envVar: "GCP_NPM_SA_JSON_BASE64",
    repo: "npm",
    location: "asia-south1",
    host: "asia-npm.pkg.dev",
    label: "npm registry",
    url: "asia-npm.pkg.dev/rio-platform/npm/",
  },
  python: {
    envVar: "GCP_PYTHON_SA_JSON_BASE64",
    repo: process.env.DX_PYTHON_ARTIFACT_REPO ?? "python",
    location: "asia-south1",
    host: "asia-south1-python.pkg.dev",
    label: "Python registry",
    url: "asia-south1-python.pkg.dev/rio-platform/python/",
  },
  docker: {
    envVar: "GCP_DOCKER_SA_JSON_BASE64",
    repo: "docker",
    location: "asia-south2",
    host: "asia-south2-docker.pkg.dev",
    label: "Docker registry",
    url: "asia-south2-docker.pkg.dev/rio-platform/docker/",
  },
}

const LEGACY_ENV_VAR = "GCP_SERVICE_ACCOUNT_JSON_BASE64"
const WRITE_ACCESS_VAR = "DX_REGISTRY_WRITE_ACCESS"

export const PKG_TYPE_REGISTRY: Record<string, string> = {
  java: "maven",
  npm: "npm",
  python: "python",
}

// ---------------------------------------------------------------------------
// .env helpers
// ---------------------------------------------------------------------------

export function readDotenv(root: string): Record<string, string> {
  const envFile = join(root, ".env")
  const result: Record<string, string> = {}
  if (!existsSync(envFile)) return result
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 0) continue
    result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
  }
  return result
}

export function writeDotenv(
  root: string,
  updates: Record<string, string>
): void {
  const envFile = join(root, ".env")
  const lines: string[] = []
  const updatedKeys = new Set<string>()

  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const key = trimmed.split("=", 1)[0].trim()
        if (key in updates) {
          lines.push(`${key}=${updates[key]}`)
          updatedKeys.add(key)
          continue
        }
      }
      lines.push(line)
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) lines.push(`${key}=${value}`)
  }

  writeFileSync(envFile, lines.join("\n") + "\n")
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

export function decodeSaBase64(b64: string): string | null {
  try {
    let normalized = b64.replace(/\s/g, "")
    if (!normalized) return null
    const pad = normalized.length % 4
    if (pad) normalized += "=".repeat(4 - pad)
    return Buffer.from(normalized, "base64").toString("utf8")
  } catch {
    return null
  }
}

export function extractEmail(saJson: string): string | null {
  try {
    return JSON.parse(saJson)?.client_email ?? null
  } catch {
    return null
  }
}

export async function loadSaJson(
  registryType: string,
  root?: string,
  keyFile?: string
): Promise<string | null> {
  // 1. Explicit key file
  if (keyFile) {
    try {
      return readFileSync(keyFile, "utf8")
    } catch {
      console.error(`Could not read key file: ${keyFile}`)
      return null
    }
  }

  const reg = REGISTRIES[registryType]
  if (!reg) return null

  // 2. Registry-specific env var
  const b64 = process.env[reg.envVar]
  if (b64) {
    const decoded = decodeSaBase64(b64)
    if (decoded) return decoded
  }

  // 3. Legacy env var
  const legacy = process.env[LEGACY_ENV_VAR]
  if (legacy) {
    const decoded = decodeSaBase64(legacy)
    if (decoded) return decoded
  }

  // 3.5. dx secret local store (~/.config/dx/secrets.json)
  try {
    const { localSecretGet } = await import("../secret-local-store.js")
    const secretB64 =
      localSecretGet(reg.envVar) ?? localSecretGet(LEGACY_ENV_VAR)
    if (secretB64) {
      const decoded = decodeSaBase64(secretB64)
      if (decoded) return decoded
    }
  } catch {
    // Local secret store unavailable — fall through
  }

  // 4. Global store (~/.config/dx/registry-auth.json)
  try {
    const { registryAuthStore } = await import("./registry-auth-store.js")
    const stored = await registryAuthStore.read()
    const globalB64 = stored[reg.envVar as keyof typeof stored]
    if (typeof globalB64 === "string" && globalB64.length > 0) {
      const decoded = decodeSaBase64(globalB64)
      if (decoded) return decoded
    }
  } catch {
    // Global store unavailable — fall through
  }

  // 5. .env file (backward compat)
  if (root) {
    const dotenv = readDotenv(root)
    const envB64 = dotenv[reg.envVar] ?? dotenv[LEGACY_ENV_VAR]
    if (envB64) {
      const decoded = decodeSaBase64(envB64)
      if (decoded) return decoded
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// gcloud helpers
// ---------------------------------------------------------------------------

export function gcloudAvailable(): boolean {
  return run("gcloud", ["--version"]).status === 0
}

export function validateSaWithGcloud(saJson: string): {
  ok: boolean
  message: string
} {
  const email = extractEmail(saJson)
  if (!email) return { ok: false, message: "Could not extract client_email" }

  const tmpPath = join(tmpdir(), `dx-sa-${Date.now()}.json`)
  writeFileSync(tmpPath, saJson)

  try {
    const result = run("gcloud", [
      "auth",
      "activate-service-account",
      email,
      `--key-file=${tmpPath}`,
    ])
    if (result.status !== 0) {
      return {
        ok: false,
        message: `Activation failed: ${result.stderr || result.stdout}`,
      }
    }
    return { ok: true, message: email }
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Per-registry auth configurators
// ---------------------------------------------------------------------------

export function configureMavenAuth(saJson: string): boolean {
  const b64Key = Buffer.from(saJson).toString("base64")
  const arHost = REGISTRIES.maven.host

  const m2Dir = join(homedir(), ".m2")
  mkdirSync(m2Dir, { recursive: true })

  const settingsXml = `<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0
                              https://maven.apache.org/xsd/settings-1.0.0.xsd">
  <servers>
    <server>
      <id>artifact-registry</id>
      <username>_json_key_base64</username>
      <password>${b64Key}</password>
    </server>
    <server>
      <id>${arHost}</id>
      <username>_json_key_base64</username>
      <password>${b64Key}</password>
    </server>
  </servers>
</settings>
`
  writeFileSync(join(m2Dir, "settings.xml"), settingsXml)
  return true
}

export function configureNpmAuth(saJson: string, root: string): boolean {
  const tmpPath = join(tmpdir(), `dx-npm-sa-${Date.now()}.json`)
  writeFileSync(tmpPath, saJson)

  try {
    const result = run("npx", ["get-artifactregistry-token@3.4.2"], {
      cwd: root,
      env: { GOOGLE_APPLICATION_CREDENTIALS: tmpPath },
    })
    return result.status === 0
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {}
  }
}

export function configureDockerAuth(saJson: string): boolean {
  const host = REGISTRIES.docker.host
  const email = extractEmail(saJson)

  const tmpPath = join(tmpdir(), `dx-docker-sa-${Date.now()}.json`)
  writeFileSync(tmpPath, saJson)

  try {
    if (email) {
      run("gcloud", [
        "auth",
        "activate-service-account",
        email,
        `--key-file=${tmpPath}`,
      ])
    }
    const result = run("gcloud", ["auth", "configure-docker", host, "--quiet"])
    return result.status === 0
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {}
  }
}

export function pythonRepositoryUrl(): string {
  const reg = REGISTRIES.python
  return `https://${reg.location}-python.pkg.dev/${GCP_PROJECT}/${reg.repo}/`
}

export function pythonTwineEnv(saJson: string): Record<string, string> {
  const b64Key = Buffer.from(saJson).toString("base64")
  return {
    TWINE_USERNAME: "_json_key_base64",
    TWINE_PASSWORD: b64Key,
  }
}

// ---------------------------------------------------------------------------
// Write-access gate
// ---------------------------------------------------------------------------

export async function checkWriteAccessGate(
  registryType: string,
  root: string
): Promise<boolean> {
  const dotenv = readDotenv(root)
  let writeAccess: string | undefined =
    dotenv[WRITE_ACCESS_VAR] ?? process.env[WRITE_ACCESS_VAR]

  // Fall back to global store
  if (!writeAccess) {
    try {
      const { registryAuthStore } = await import("./registry-auth-store.js")
      const stored = await registryAuthStore.read()
      if (stored.DX_REGISTRY_WRITE_ACCESS) {
        writeAccess = stored.DX_REGISTRY_WRITE_ACCESS
      }
    } catch {
      // ignore
    }
  }

  if (!writeAccess) return true

  const allowed = new Set(writeAccess.split(",").map((r) => r.trim()))
  const regName = PKG_TYPE_REGISTRY[registryType] ?? registryType
  return allowed.has(regName)
}
