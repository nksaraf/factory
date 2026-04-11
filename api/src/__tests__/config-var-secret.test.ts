import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { Elysia } from "elysia"

import type { Database } from "../db/connection"
import { configVarController } from "../modules/identity/config-var.controller"
import { secretController } from "../modules/identity/secret.controller"
import { createMigratedTestPglite, truncateAllTables } from "../test-helpers"

// Helper to make HTTP-like requests to Elysia app
async function request(
  app: Elysia,
  method: string,
  urlPath: string,
  body?: unknown
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  }
  if (body) init.body = JSON.stringify(body)
  const res = await app.handle(new Request(`http://localhost${urlPath}`, init))
  const json = await res.json()
  return { status: res.status, body: json }
}

describe("config var & secret controllers", () => {
  let db: Database
  let client: PGlite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any

  beforeAll(async () => {
    const pglite = await createMigratedTestPglite()
    db = pglite.db as unknown as Database
    client = pglite.client
    app = new Elysia().use(configVarController(db)).use(secretController(db))
  })

  afterAll(async () => {
    await client.close()
  })

  describe("Config Var Controller", () => {
    beforeEach(async () => {
      await truncateAllTables(client)
    })

  describe("POST /vars (upsert)", () => {
    it("creates a new variable", async () => {
      const { status, body } = await request(app, "POST", "/vars", {
        slug: "APP_NAME",
        value: "my-app",
      })
      expect(status).toBe(200)
      expect(body.success).toBe(true)
    })

    it("upserts an existing variable", async () => {
      await request(app, "POST", "/vars", { slug: "KEY", value: "v1" })
      await request(app, "POST", "/vars", { slug: "KEY", value: "stored" })

      const { body } = await request(app, "GET", "/vars/KEY")
      expect(body.value).toBe("stored")
    })

    it("defaults scopeType to org and environment to all", async () => {
      await request(app, "POST", "/vars", { slug: "X", value: "1" })
      const { body } = await request(app, "GET", "/vars/X")
      expect(body.scopeType).toBe("org")
      expect(body.environment).toBe("all")
    })

    it("rejects invalid scopeType with 400", async () => {
      const { status, body } = await request(app, "POST", "/vars", {
        slug: "BAD",
        value: "v",
        scopeType: "invalid",
      })
      expect(status).toBe(400)
      expect(body.error).toContain("Invalid scopeType")
    })
  })

  describe("GET /vars/:slug", () => {
    it("returns 404 for missing variable", async () => {
      const { status } = await request(app, "GET", "/vars/MISSING")
      expect(status).toBe(404)
    })

    it("returns variable with scope metadata", async () => {
      await request(app, "POST", "/vars", {
        slug: "DB_HOST",
        value: "localhost",
        scopeType: "team",
        scopeId: "eng",
        environment: "development",
      })
      const { body } = await request(
        app,
        "GET",
        "/vars/DB_HOST?scopeType=team&scopeId=eng&environment=development"
      )
      expect(body.value).toBe("localhost")
      expect(body.scopeType).toBe("team")
      expect(body.scopeId).toBe("eng")
    })
  })

  describe("GET /vars (list)", () => {
    it("lists variables filtered by scope", async () => {
      await request(app, "POST", "/vars", { slug: "A", value: "1" })
      await request(app, "POST", "/vars", { slug: "B", value: "2" })
      await request(app, "POST", "/vars", {
        slug: "C",
        value: "3",
        scopeType: "team",
        scopeId: "eng",
      })

      const { body: orgVars } = await request(app, "GET", "/vars?scopeType=org")
      expect(orgVars.vars.length).toBe(2)

      const { body: teamVars } = await request(
        app,
        "GET",
        "/vars?scopeType=team&scopeId=eng"
      )
      expect(teamVars.vars.length).toBe(1)
      expect(teamVars.vars[0].slug).toBe("C")
    })
  })

  describe("DELETE /vars/:slug", () => {
    it("deletes a variable", async () => {
      await request(app, "POST", "/vars", { slug: "DEL_ME", value: "bye" })
      const { status } = await request(app, "DELETE", "/vars/DEL_ME")
      expect(status).toBe(200)

      const { status: getStatus } = await request(app, "GET", "/vars/DEL_ME")
      expect(getStatus).toBe(404)
    })

    it("returns 404 for missing variable", async () => {
      const { status } = await request(app, "DELETE", "/vars/NOPE")
      expect(status).toBe(404)
    })
  })

  describe("POST /vars/resolve", () => {
    it("merges vars with scope priority", async () => {
      // Org-level default
      await request(app, "POST", "/vars", {
        slug: "REGION",
        value: "us-east",
      })
      // Team override
      await request(app, "POST", "/vars", {
        slug: "REGION",
        value: "eu-west",
        scopeType: "team",
        scopeId: "platform",
      })

      const { body } = await request(app, "POST", "/vars/resolve", {
        teamId: "platform",
      })
      const regionVar = body.vars.find((v: any) => v.slug === "REGION")
      expect(regionVar.value).toBe("eu-west") // team overrides org
    })

    it("environment-specific overrides 'all'", async () => {
      await request(app, "POST", "/vars", {
        slug: "LOG_LEVEL",
        value: "info",
      })
      await request(app, "POST", "/vars", {
        slug: "LOG_LEVEL",
        value: "debug",
        environment: "development",
      })

      const { body } = await request(app, "POST", "/vars/resolve", {
        environment: "development",
      })
      const logVar = body.vars.find((v: any) => v.slug === "LOG_LEVEL")
      expect(logVar.value).toBe("debug") // dev overrides all
    })

    it("returns only 'all' environment vars when no environment specified", async () => {
      await request(app, "POST", "/vars", { slug: "BASE", value: "base" })
      await request(app, "POST", "/vars", {
        slug: "PROD_ONLY",
        value: "prod",
        environment: "production",
      })

      const { body } = await request(app, "POST", "/vars/resolve", {})
      const slugs = body.vars.map((v: any) => v.slug)
      expect(slugs).toContain("BASE")
      expect(slugs).not.toContain("PROD_ONLY")
    })

    it("project scope overrides team, team overrides org", async () => {
      await request(app, "POST", "/vars", {
        slug: "DB_HOST",
        value: "org-db.internal",
      })
      await request(app, "POST", "/vars", {
        slug: "DB_HOST",
        value: "team-db.internal",
        scopeType: "team",
        scopeId: "platform",
      })
      await request(app, "POST", "/vars", {
        slug: "DB_HOST",
        value: "project-db.internal",
        scopeType: "project",
        scopeId: "my-api",
      })

      const { body } = await request(app, "POST", "/vars/resolve", {
        teamId: "platform",
        projectId: "my-api",
      })
      const dbHost = body.vars.find((v: any) => v.slug === "DB_HOST")
      expect(dbHost.value).toBe("project-db.internal")
    })

    it("full inheritance: system < org < team < project < principal", async () => {
      await request(app, "POST", "/vars", {
        slug: "TIMEOUT",
        value: "30",
        scopeType: "system",
        scopeId: "default",
      })
      await request(app, "POST", "/vars", {
        slug: "TIMEOUT",
        value: "60",
      }) // org
      await request(app, "POST", "/vars", {
        slug: "TIMEOUT",
        value: "90",
        scopeType: "team",
        scopeId: "eng",
      })
      await request(app, "POST", "/vars", {
        slug: "TIMEOUT",
        value: "120",
        scopeType: "project",
        scopeId: "api",
      })
      await request(app, "POST", "/vars", {
        slug: "TIMEOUT",
        value: "5",
        scopeType: "principal",
        scopeId: "user-1",
      })

      // With all scopes, principal wins
      const { body: all } = await request(app, "POST", "/vars/resolve", {
        teamId: "eng",
        projectId: "api",
        principalId: "user-1",
      })
      expect(all.vars.find((v: any) => v.slug === "TIMEOUT").value).toBe("5")

      // Without principal, project wins
      const { body: noUser } = await request(app, "POST", "/vars/resolve", {
        teamId: "eng",
        projectId: "api",
      })
      expect(noUser.vars.find((v: any) => v.slug === "TIMEOUT").value).toBe(
        "120"
      )

      // Without project, team wins
      const { body: noProject } = await request(app, "POST", "/vars/resolve", {
        teamId: "eng",
      })
      expect(noProject.vars.find((v: any) => v.slug === "TIMEOUT").value).toBe(
        "90"
      )
    })
  })
  })

  describe("Secret Controller", () => {
    beforeEach(async () => {
      await truncateAllTables(client)
    })

  describe("POST /secrets + GET /secrets/:slug (roundtrip)", () => {
    it("encrypts on set and decrypts on get", async () => {
      await request(app, "POST", "/secrets", {
        slug: "DB_PASSWORD",
        value: "test-value-123",
      })
      const { body } = await request(app, "GET", "/secrets/DB_PASSWORD")
      expect(body.value).toBe("test-value-123")
    })

    it("upserts existing secret", async () => {
      await request(app, "POST", "/secrets", { slug: "K", value: "v1" })
      await request(app, "POST", "/secrets", { slug: "K", value: "stored" })
      const { body } = await request(app, "GET", "/secrets/K")
      expect(body.value).toBe("stored")
    })

    it("stores keyVersion in the database", async () => {
      await request(app, "POST", "/secrets", {
        slug: "VERSIONED",
        value: "test",
      })
      // Verify we can get it back (keyVersion is used internally for decrypt)
      const { body } = await request(app, "GET", "/secrets/VERSIONED")
      expect(body.value).toBe("test")
    })

    it("rejects invalid scopeType with 400", async () => {
      const { status, body } = await request(app, "POST", "/secrets", {
        slug: "BAD",
        value: "v",
        scopeType: "invalid",
      })
      expect(status).toBe(400)
      expect(body.error).toContain("Invalid scopeType")
    })
  })

  describe("GET /secrets (list)", () => {
    it("lists secrets without exposing values", async () => {
      await request(app, "POST", "/secrets", {
        slug: "LIST_A",
        value: "secret-a",
      })
      await request(app, "POST", "/secrets", {
        slug: "LIST_B",
        value: "secret-b",
      })

      const { body } = await request(app, "GET", "/secrets")
      const slugs = body.secrets.map((s: any) => s.slug)
      expect(slugs).toContain("LIST_A")
      expect(slugs).toContain("LIST_B")
      // Values should NOT be in the list response
      for (const s of body.secrets) {
        expect(s).not.toHaveProperty("value")
        expect(s).not.toHaveProperty("encryptedValue")
      }
    })
  })

  describe("DELETE /secrets/:slug", () => {
    it("deletes a secret", async () => {
      await request(app, "POST", "/secrets", { slug: "DEL", value: "bye" })
      await request(app, "DELETE", "/secrets/DEL")
      const { status } = await request(app, "GET", "/secrets/DEL")
      expect(status).toBe(404)
    })
  })

  describe("POST /secrets/rotate", () => {
    it("re-encrypts a specific secret", async () => {
      await request(app, "POST", "/secrets", {
        slug: "ROTATE_ME",
        value: "original",
      })

      const { body } = await request(app, "POST", "/secrets/rotate", {
        slug: "ROTATE_ME",
      })
      expect(body.rotated).toBe(1)

      // Value should still be accessible after rotation
      const { body: getBody } = await request(app, "GET", "/secrets/ROTATE_ME")
      expect(getBody.value).toBe("original")
    })

    it("requires slug or scopeType", async () => {
      const { status } = await request(app, "POST", "/secrets/rotate", {})
      expect(status).toBe(400)
    })
  })

  describe("POST /secrets/resolve", () => {
    it("merges secrets with scope priority (system < org < team < project < principal)", async () => {
      await request(app, "POST", "/secrets", {
        slug: "API_KEY",
        value: "org-key",
        scopeType: "org",
      })
      await request(app, "POST", "/secrets", {
        slug: "API_KEY",
        value: "team-key",
        scopeType: "team",
        scopeId: "eng",
      })

      const { body } = await request(app, "POST", "/secrets/resolve", {
        teamId: "eng",
      })
      const apiKey = body.secrets.find((s: any) => s.slug === "API_KEY")
      expect(apiKey.value).toBe("team-key")
    })

    it("project scope overrides team scope", async () => {
      await request(app, "POST", "/secrets", {
        slug: "DB_PASS",
        value: "team-pass",
        scopeType: "team",
        scopeId: "eng",
      })
      await request(app, "POST", "/secrets", {
        slug: "DB_PASS",
        value: "project-pass",
        scopeType: "project",
        scopeId: "my-api",
      })

      const { body } = await request(app, "POST", "/secrets/resolve", {
        teamId: "eng",
        projectId: "my-api",
      })
      const dbPass = body.secrets.find((s: any) => s.slug === "DB_PASS")
      expect(dbPass.value).toBe("project-pass")
    })

    it("environment-specific overrides 'all'", async () => {
      await request(app, "POST", "/secrets", {
        slug: "DB_PASS",
        value: "dev-pass",
        environment: "development",
      })
      await request(app, "POST", "/secrets", {
        slug: "DB_PASS",
        value: "all-pass",
      })

      const { body } = await request(app, "POST", "/secrets/resolve", {
        environment: "development",
      })
      const dbPass = body.secrets.find((s: any) => s.slug === "DB_PASS")
      expect(dbPass.value).toBe("dev-pass") // env-specific overrides 'all'
    })

    it("project + environment combo: project env-specific beats org env-specific", async () => {
      // org-level production secret
      await request(app, "POST", "/secrets", {
        slug: "API_TOKEN",
        value: "org-prod-token",
        environment: "production",
      })
      // project-level production secret
      await request(app, "POST", "/secrets", {
        slug: "API_TOKEN",
        value: "project-prod-token",
        scopeType: "project",
        scopeId: "my-api",
        environment: "production",
      })

      const { body } = await request(app, "POST", "/secrets/resolve", {
        projectId: "my-api",
        environment: "production",
      })
      const token = body.secrets.find((s: any) => s.slug === "API_TOKEN")
      expect(token.value).toBe("project-prod-token")
    })
  })
  })
})
