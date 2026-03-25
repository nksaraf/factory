/**
 * dx pkg auth — configure and check registry credentials.
 */

import { printKeyValue } from "../../output.js";
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
    throw new Error(
      "Provide credentials via --key-file <path> or --key <base64>"
    );
  }

  // Validate JSON
  const email = extractEmail(saJson);
  if (!email) {
    throw new Error("Invalid SA JSON — no client_email found");
  }

  console.log(`Service account: ${email}`);

  // Store in .env (same key for all registries)
  const updates: Record<string, string> = {};
  for (const reg of Object.values(REGISTRIES)) {
    updates[reg.envVar] = b64Value;
  }
  writeDotenv(root, updates);
  console.log("Credentials saved to .env");

  // Configure per-registry auth
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

  console.log("\nSetup complete.");
}

async function checkCredentials(root: string): Promise<void> {
  console.log("Checking registry credentials...\n");
  const dotenv = readDotenv(root);
  let found = false;

  for (const [name, reg] of Object.entries(REGISTRIES)) {
    const b64 = dotenv[reg.envVar];
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
    const email = extractEmail(decoded);
    console.log(`${reg.label}: ${email ?? "unknown"}`);
  }

  if (!found) {
    console.log(
      "\nNo credentials found. Run 'dx pkg auth --key-file <path>' to configure."
    );
  }
}
