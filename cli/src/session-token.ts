import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { configDir, createStore } from "@crustjs/store";

/**
 * Typed session persistence via {@link https://crustjs.com/docs/modules/store | @crustjs/store}.
 * Uses `read` / `write` / `update` / `reset` — no manual filesystem IO.
 */
const SESSION_DIR = configDir("dx");

/** Resolved path for `session.json` (same file {@link dxSessionStore} uses). */
export const SESSION_FILE = path.join(SESSION_DIR, "session.json");

export const dxSessionStore = createStore({
  dirPath: SESSION_DIR,
  name: "session",
  fields: {
    bearerToken: { type: "string", default: "" },
    jwt: { type: "string", default: "" },
  },
});

export type SessionPayload = {
  bearerToken?: string;
  jwt?: string;
};

function toPayload(s: {
  bearerToken: string;
  jwt: string;
}): SessionPayload {
  const out: SessionPayload = {};
  if (s.bearerToken.length > 0) {
    out.bearerToken = s.bearerToken;
  }
  if (s.jwt.length > 0) {
    out.jwt = s.jwt;
  }
  return out;
}

export async function readSession(): Promise<SessionPayload> {
  const s = await dxSessionStore.read();
  return toPayload(s);
}

export async function getStoredBearerToken(): Promise<string | undefined> {
  const t = (await readSession()).bearerToken;
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

export async function getStoredJwt(): Promise<string | undefined> {
  const t = (await readSession()).jwt;
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

/**
 * Merges `update` into persisted session (only keys present in `update` are changed).
 * Clears the backing file when both tokens end up empty.
 */
export async function writeSession(update: SessionPayload): Promise<void> {
  await dxSessionStore.update((prev) => {
    const next = { bearerToken: prev.bearerToken, jwt: prev.jwt };
    for (const [k, val] of Object.entries(update) as [
      keyof SessionPayload,
      string | undefined,
    ][]) {
      if (val === undefined) {
        if (k === "bearerToken") {
          next.bearerToken = "";
        } else if (k === "jwt") {
          next.jwt = "";
        }
      } else {
        next[k] = val;
      }
    }
    return next;
  });
  const after = await dxSessionStore.read();
  if (after.bearerToken === "" && after.jwt === "") {
    await dxSessionStore.reset();
  }
}

export async function clearAuthSession(): Promise<void> {
  await dxSessionStore.reset();
}

// ---------------------------------------------------------------------------
// Named auth profiles
// ---------------------------------------------------------------------------

/** Directory for per-workbench auth profiles. */
export const SESSION_PROFILES_DIR = path.join(SESSION_DIR, "sessions");

const SESSION_FIELDS = {
  bearerToken: { type: "string", default: "" },
  jwt: { type: "string", default: "" },
} as const;

/** Create a store for a named auth profile. */
export function createProfileStore(profileName: string) {
  return createStore({
    dirPath: SESSION_PROFILES_DIR,
    name: profileName,
    fields: SESSION_FIELDS,
  });
}

/** Read session from a named profile. */
export async function readSessionForProfile(profileName: string): Promise<SessionPayload> {
  const store = createProfileStore(profileName);
  const s = await store.read();
  return toPayload(s);
}

/** Get bearer token from a named profile. */
export async function getStoredBearerTokenForProfile(profileName: string): Promise<string | undefined> {
  const t = (await readSessionForProfile(profileName)).bearerToken;
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

/** Write session to a named profile. */
export async function writeSessionForProfile(profileName: string, update: SessionPayload): Promise<void> {
  const store = createProfileStore(profileName);
  await store.update((prev) => {
    const next = { bearerToken: prev.bearerToken, jwt: prev.jwt };
    for (const [k, val] of Object.entries(update) as [keyof SessionPayload, string | undefined][]) {
      if (val === undefined) {
        next[k] = "";
      } else {
        next[k] = val;
      }
    }
    return next;
  });
  const after = await store.read();
  if (after.bearerToken === "" && after.jwt === "") {
    await store.reset();
  }
}

/**
 * Resolve the active auth profile name.
 * Walks up from cwd to find `.dx/workbench.json` with an `authProfile` field.
 * Falls back to "default" (which maps to the global session.json).
 */
export function resolveActiveProfile(): string {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, ".dx", "workbench.json");
    if (existsSync(candidate)) {
      try {
        const config = JSON.parse(readFileSync(candidate, "utf8"));
        if (typeof config.authProfile === "string" && config.authProfile.length > 0) {
          return config.authProfile;
        }
      } catch {
        // malformed json — fall through
      }
      break; // found workbench.json but no profile — use default
    }
    dir = path.dirname(dir);
  }
  return "default";
}
