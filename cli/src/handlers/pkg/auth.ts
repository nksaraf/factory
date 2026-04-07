/**
 * dx pkg auth — configure and check registry credentials.
 *
 * Stores keys globally (~/.config/dx/registry-auth.json) so every project on
 * the machine can authenticate, and also writes to the local .env for tools
 * that read credentials from the environment directly.
 */

import {
  REGISTRIES,
  decodeSaBase64,
  extractEmail,
  gcloudAvailable,
  loadSaJson,
  readDotenv,
  writeDotenv,
  configureMavenAuth,
  configureNpmAuth,
  configureDockerAuth,
} from "./registry.js";
import { registryAuthStore } from "./registry-auth-store.js";
import { localSecretSetMany, localSecretGet } from "../secret-local-store.js";
import { probeAllRegistries } from "./registry-probe.js";

export interface AuthOptions {
  check?: boolean;
  keyFile?: string;
  key?: string;
  verbose?: boolean;
}

export async function pkgAuth(root: string, opts: AuthOptions): Promise<void> {
  if (opts.check) {
    await checkCredentials(root);
    return;
  }

  console.log("GCP Artifact Registry Setup\n");

  let saJson: string | null = null;
  let b64Value: string;

  if (opts.keyFile) {
    const { readFileSync } = await import("node:fs");
    try {
      saJson = readFileSync(opts.keyFile, "utf8");
      b64Value = Buffer.from(saJson).toString("base64");
    } catch {
      throw new Error(`Could not read key file: ${opts.keyFile}`);
    }
  } else if (opts.key) {
    saJson = decodeSaBase64(opts.key);
    if (!saJson) throw new Error("Invalid base64 — could not decode");
    b64Value = opts.key;
  } else {
    // No key provided — re-authenticate from global store
    await reauthFromGlobal(root);
    return;
  }

  // Validate JSON
  const email = extractEmail(saJson);
  if (!email) {
    throw new Error("Invalid SA JSON — no client_email found");
  }

  console.log(`Service account: ${email}`);

  // Build update map (same key for all registries + universal key)
  const updates: Record<string, string> = {
    GOOGLE_APPLICATION_CREDENTIALS_BASE64: b64Value,
  };
  for (const reg of Object.values(REGISTRIES)) {
    updates[reg.envVar] = b64Value;
  }

  // 1. Save to dx secret local store (~/.config/dx/secrets.json, 0600)
  localSecretSetMany(updates);
  console.log("Credentials saved to ~/.config/dx/secrets.json (local secret store)");

  // 2. Save to global store (~/.config/dx/registry-auth.json) for backward compat
  await registryAuthStore.update((prev) => ({ ...prev, ...updates }));
  console.log("Credentials saved to ~/.config/dx/registry-auth.json (global)");

  // 3. Save to local .env for other tools
  writeDotenv(root, updates);
  console.log("Credentials saved to .env (local)");

  // Configure per-registry auth
  configureRegistries(saJson, root);

  console.log("\nSetup complete.");
}

// ---------------------------------------------------------------------------
// Re-authenticate registries from existing global key
// ---------------------------------------------------------------------------

async function reauthFromGlobal(root: string): Promise<void> {
  // Check local secret store first, then fall back to global registry-auth store
  const localB64 =
    localSecretGet("GOOGLE_APPLICATION_CREDENTIALS_BASE64") ||
    localSecretGet("GCP_NPM_SA_JSON_BASE64") ||
    localSecretGet("GCP_MAVEN_SA_JSON_BASE64") ||
    localSecretGet("GCP_PYTHON_SA_JSON_BASE64") ||
    localSecretGet("GCP_DOCKER_SA_JSON_BASE64");

  const stored = await registryAuthStore.read();
  const globalB64 =
    stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    stored.GCP_NPM_SA_JSON_BASE64 ||
    stored.GCP_MAVEN_SA_JSON_BASE64 ||
    stored.GCP_PYTHON_SA_JSON_BASE64 ||
    stored.GCP_DOCKER_SA_JSON_BASE64;

  const b64 = localB64 || globalB64;

  if (!b64) {
    throw new Error(
      "No credentials found in local secrets or global store.\n" +
        "Provide credentials via --key-file <path> or --key <base64>"
    );
  }

  const saJson = decodeSaBase64(b64);
  if (!saJson) {
    throw new Error("Stored credentials are invalid — run dx pkg auth --key-file <path> to reconfigure");
  }

  const email = extractEmail(saJson);
  console.log(`Re-authenticating registries using global key: ${email ?? "unknown"}\n`);

  // Also refresh local .env
  const updates: Record<string, string> = {
    GOOGLE_APPLICATION_CREDENTIALS_BASE64: b64,
  };
  for (const reg of Object.values(REGISTRIES)) {
    updates[reg.envVar] = b64;
  }
  writeDotenv(root, updates);
  console.log("Credentials written to .env (local)");

  configureRegistries(saJson, root);

  console.log("\nRe-authentication complete.");
}

// ---------------------------------------------------------------------------
// Shared per-registry configurators
// ---------------------------------------------------------------------------

function configureRegistries(saJson: string, root: string): void {
  const hasGcloud = gcloudAvailable();

  configureMavenAuth(saJson);
  console.log("Maven auth configured (~/.m2/settings.xml)");

  const npmOk = configureNpmAuth(saJson, root);
  if (npmOk) console.log("npm auth configured");
  else console.warn("npm auth configuration failed (non-fatal)");

  if (hasGcloud) {
    const dockerOk = configureDockerAuth(saJson);
    if (dockerOk) console.log("Docker auth configured");
    else console.warn("Docker auth configuration failed (non-fatal)");
  } else {
    console.warn(
      "gcloud not found — Docker auth skipped (install gcloud to enable)"
    );
  }
}

// ---------------------------------------------------------------------------
// Check configured credentials
// ---------------------------------------------------------------------------

async function checkCredentials(root: string): Promise<void> {
  console.log("Checking registry credentials...\n");

  // Read all sources: local secrets, global store, .env
  const dotenv = readDotenv(root);
  let globalAuth: Record<string, string> = {};
  try {
    const stored = await registryAuthStore.read();
    globalAuth = Object.fromEntries(
      Object.entries(stored).filter((e): e is [string, string] => typeof e[1] === "string")
    );
  } catch {
    // global store unavailable
  }

  let found = false;
  let saJsonForProbe: string | null = null;

  for (const [_name, reg] of Object.entries(REGISTRIES)) {
    const secretVal = localSecretGet(reg.envVar);
    const globalVal = globalAuth[reg.envVar];
    const dotenvVal = dotenv[reg.envVar];
    const b64 = secretVal || globalVal || dotenvVal;

    if (!b64) {
      console.log(`${reg.label}: not configured`);
      continue;
    }
    found = true;
    const decoded = decodeSaBase64(b64);
    if (!decoded) {
      console.log(`${reg.label}: invalid base64`);
      continue;
    }
    if (!saJsonForProbe) saJsonForProbe = decoded;
    const email = extractEmail(decoded);
    const source = secretVal
      ? "(local secret)"
      : globalVal
        ? "(global)"
        : "(project .env)";
    console.log(`${reg.label}: ${email ?? "unknown"} ${source}`);
  }

  // Check GOOGLE_APPLICATION_CREDENTIALS_BASE64
  const universalSecret = localSecretGet("GOOGLE_APPLICATION_CREDENTIALS_BASE64");
  const universalB64 =
    universalSecret ||
    globalAuth["GOOGLE_APPLICATION_CREDENTIALS_BASE64"] ||
    dotenv["GOOGLE_APPLICATION_CREDENTIALS_BASE64"];
  if (universalB64) {
    const decoded = decodeSaBase64(universalB64);
    const email = decoded ? extractEmail(decoded) : null;
    if (!saJsonForProbe && decoded) saJsonForProbe = decoded;
    const source = universalSecret
      ? "(local secret)"
      : globalAuth["GOOGLE_APPLICATION_CREDENTIALS_BASE64"]
        ? "(global)"
        : "(project .env)";
    console.log(
      `GOOGLE_APPLICATION_CREDENTIALS_BASE64: ${email ?? "set"} ${source}`
    );
    found = true;
  }

  if (!found) {
    console.log(
      "\nNo credentials found. Run 'dx pkg auth --key-file <path>' to configure."
    );
    return;
  }

  // Validate credentials against actual registries
  if (saJsonForProbe) {
    console.log("\nValidating registry access...\n");
    const results = await probeAllRegistries(saJsonForProbe);
    for (const r of results) {
      const statusTag =
        r.status === "pass"
          ? "PASS"
          : r.status === "fail"
            ? "FAIL"
            : "SKIP";
      const httpPart = r.httpStatus ? ` (${r.httpStatus})` : "";
      console.log(`  ${r.label.padEnd(20)} ${statusTag}${httpPart} — ${r.message}`);
      if (r.hint) {
        console.log(`${"".padEnd(22)} Hint: ${r.hint}`);
      }
    }
  }
}
