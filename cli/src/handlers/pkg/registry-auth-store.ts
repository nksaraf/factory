/**
 * Machine-wide registry auth store at ~/.config/dx/registry-auth.json.
 *
 * Stores base64-encoded GCP service-account keys so that every project on the
 * machine can authenticate against Artifact Registry without per-project setup.
 */

import { configDir, createStore } from "@crustjs/store";

const DX_CONFIG_DIR = configDir("dx");

export const registryAuthStore = createStore({
  dirPath: DX_CONFIG_DIR,
  name: "registry-auth",
  fields: {
    GCP_MAVEN_SA_JSON_BASE64: { type: "string", default: "" },
    GCP_NPM_SA_JSON_BASE64: { type: "string", default: "" },
    GCP_PYTHON_SA_JSON_BASE64: { type: "string", default: "" },
    GCP_DOCKER_SA_JSON_BASE64: { type: "string", default: "" },
    GOOGLE_APPLICATION_CREDENTIALS_BASE64: { type: "string", default: "" },
    DX_REGISTRY_WRITE_ACCESS: { type: "string", default: "" },
  },
});

export type RegistryAuthData = Awaited<ReturnType<typeof registryAuthStore.read>>;

/**
 * Load global auth keys into `process.env` so every subprocess inherits them.
 * Only sets a variable when it is not already present in the environment
 * (explicit env vars always take precedence).
 */
export async function loadGlobalAuthEnv(): Promise<void> {
  try {
    const stored = await registryAuthStore.read();
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "string" && value.length > 0 && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Global store unavailable — silently continue
  }
}
