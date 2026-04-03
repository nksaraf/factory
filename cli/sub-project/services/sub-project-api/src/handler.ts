import { defineEventHandler, toWebRequest } from "vinxi/http";

import { createServer } from "./server";

const appPromise = createServer();

export default defineEventHandler(async (event) => {
  const app = await appPromise;
  const request = toWebRequest(event);
  return app.fetch(request);
});
