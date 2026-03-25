import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FactoryAPI } from "./factory.api";

describe("FactoryAPI mounted app", () => {
  let api: FactoryAPI;

  beforeAll(async () => {
    api = await FactoryAPI.create();
  });

  afterAll(async () => {
    await api.close();
  });

  it("GET /health on createApp() returns ok", async () => {
    const app = api.createApp();
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("factory-api");
  });
});
