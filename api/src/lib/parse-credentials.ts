import type { GitHostAdapterConfig } from "../adapters/adapter-registry";

/**
 * Parse the credentialsEnc field from a git host provider. Supports:
 * - Plain string token (legacy)
 * - JSON object with { token, org, webhookSecret, ... }
 */
export function parseCredentials(credentialsEnc: string | null | undefined): Partial<GitHostAdapterConfig> {
  if (!credentialsEnc) return {};
  const trimmed = credentialsEnc.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { token: trimmed };
    }
  }
  return { token: trimmed };
}
