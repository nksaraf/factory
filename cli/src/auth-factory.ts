import { createCliAuthClient } from "@rio.js/auth-client/node";

import { readConfig, resolveFactoryUrl } from "./config.js";
import { readSession, writeSession } from "./session-token.js";
import type { DxFlags } from "./stub.js";

export async function createFactoryAuthClient(flags?: Partial<DxFlags>) {
  const cfg = await readConfig();
  const baseURL = resolveFactoryUrl(cfg);

  return createCliAuthClient({
    baseURL,
    basePath: cfg.authBasePath,
    debug: flags?.debug,
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
