import { Elysia } from "elysia"

import { HealthService } from "./service"

export const healthController = new Elysia().get("/health", () =>
  HealthService.status()
)
