import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { node } from "@elysiajs/node";

import { healthRoutes } from "./health";

export async function createServer() {
  const app = new Elysia({ adapter: node() })
    .use(cors())
    .use(healthRoutes)
    .get("/", () => ({ name: "sub-project", status: "running" }));

  return app;
}

export type Server = Awaited<ReturnType<typeof createServer>>;
