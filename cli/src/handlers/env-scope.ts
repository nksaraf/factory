/**
 * Combined env resolution from Factory API (vars + secrets).
 * When --scope is provided on `dx env resolve`, this handler fetches
 * both config vars and secrets, merges them, and outputs .env format.
 */

import { styleInfo } from "../cli-style.js";
import { getFactoryFetchClient } from "./factory-fetch.js";

export interface EnvScopeFlags {
  scope: string;
  team?: string;
  project?: string;
  env?: string;
  export?: boolean;
  json?: boolean;
}

export async function resolveEnvScope(flags: EnvScopeFlags): Promise<void> {
  const client = await getFactoryFetchClient();

  // Build resolve body
  const resolveBody: Record<string, string | null> = {};
  if (flags.team) resolveBody.teamId = flags.team;
  if (flags.project) resolveBody.projectId = flags.project;
  if (flags.env) resolveBody.environment = flags.env;

  // Fetch vars and secrets in parallel
  const [varsRes, secretsRes] = await Promise.all([
    client.fetchApi("/vars/resolve", {
      method: "POST",
      body: JSON.stringify(resolveBody),
    }),
    client.fetchApi("/secrets/resolve", {
      method: "POST",
      body: JSON.stringify(resolveBody),
    }),
  ]);

  if (!varsRes.ok) {
    const body = await varsRes.text();
    throw new Error(`Failed to resolve variables: ${varsRes.status} ${body}`);
  }
  if (!secretsRes.ok) {
    const body = await secretsRes.text();
    throw new Error(`Failed to resolve secrets: ${secretsRes.status} ${body}`);
  }

  const varsData = (await varsRes.json()) as {
    vars: Array<{ slug: string; value: string }>;
  };
  const secretsData = (await secretsRes.json()) as {
    secrets: Array<{ slug: string; value: string }>;
  };

  // Merge: vars first, secrets override
  const merged: Record<string, string> = {};
  for (const v of varsData.vars) merged[v.slug] = v.value;
  for (const s of secretsData.secrets) merged[s.slug] = s.value;

  // Output
  if (flags.json) {
    console.log(JSON.stringify(merged, null, 2));
  } else if (flags.export) {
    for (const [key, value] of Object.entries(merged)) {
      console.log(`export ${key}=${shellQuote(value)}`);
    }
  } else {
    // .env format (pipeable to docker compose)
    for (const [key, value] of Object.entries(merged)) {
      console.log(`${key}=${dotenvQuote(value)}`);
    }
  }
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_/.:=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dotenvQuote(value: string): string {
  if (/^[a-zA-Z0-9_/.:=-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}
