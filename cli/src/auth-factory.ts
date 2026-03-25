import { createCliAuthClient } from "@rio.js/auth-client/node";

import { loadConfig } from "./config.js";
import { readSession, writeSession } from "./session-token.js";
import type { DxFlags } from "./stub.js";

export function createFactoryAuthClient(flags: DxFlags) {
  const cfg = loadConfig();
  const baseURL = cfg.authUrl.replace(/\/$/, "");

  return createCliAuthClient({
    baseURL,
    basePath: cfg.authBasePath,
    debug: flags.debug,
    storage: {
      getBearerToken: async () => (await readSession()).bearerToken ?? null,
      setBearerToken: async (token: string) => {
        await writeSession({ bearerToken: token });
      },
      getJwt: async () => (await readSession()).jwt ?? null,
      setJwt: async (jwt: string) => {
        await writeSession({ jwt });
      },
    },
  });
}
