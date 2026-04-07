/**
 * Lightweight fetch-based Factory API client for CLI handlers.
 * Resolves Factory URL and bearer token, returns a simple fetchApi helper.
 */

export interface FactoryFetchClient {
  fetchApi(path: string, init?: RequestInit): Promise<Response>;
}

export async function getFactoryFetchClient(): Promise<FactoryFetchClient> {
  const { readConfig, resolveFactoryUrl } = await import("../config.js");
  const { getStoredBearerToken } = await import("../session-token.js");

  const config = await readConfig();
  const factoryUrl = resolveFactoryUrl(config);
  const token = await getStoredBearerToken();

  if (!token) {
    throw new Error(
      "Not authenticated. Run `dx auth login` first.",
    );
  }

  return {
    async fetchApi(
      path: string,
      init?: RequestInit,
    ): Promise<Response> {
      const url = `${factoryUrl}/api/v1/factory${path}`;
      return fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...init?.headers,
        },
      });
    },
  };
}
