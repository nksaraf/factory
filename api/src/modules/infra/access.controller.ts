import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import * as accessSvc from "../../services/infra/access.service"
import * as sshKeySvc from "../../services/infra/ssh-key.service"

const AccessModel = {
  resolveParams: t.Object({ slug: t.String() }),

  listKeysQuery: t.Object({
    principalId: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),

  registerKeyBody: t.Object({
    principalId: t.String(),
    name: t.String(),
    publicKey: t.String(),
    fingerprint: t.String(),
    keyType: t.Optional(t.String()),
  }),

  idParams: t.Object({ id: t.String() }),
}

export function accessController(db: Database) {
  return new Elysia({ prefix: "/access" })

    // --- Resolve slug to SSH target ---
    .get("/resolve/:slug", async ({ params, set }) => {
      const target = await accessSvc.resolveTarget(db, params.slug)
      if (!target) {
        set.status = 404
        return { success: false, error: "not_found" }
      }
      return { success: true, data: target }
    }, {
      params: AccessModel.resolveParams,
      detail: { tags: ["Access"], summary: "Resolve slug to SSH target" },
    })

    // --- List all SSH-connectable targets ---
    .get("/targets", async () => ({
      success: true,
      data: await accessSvc.listTargets(db),
    }), {
      detail: { tags: ["Access"], summary: "List all SSH targets" },
    })

    // --- SSH Keys ---
    .get("/ssh-keys", async ({ query }) => ({
      success: true,
      data: await sshKeySvc.listKeys(db, query),
    }), {
      query: AccessModel.listKeysQuery,
      detail: { tags: ["Access"], summary: "List SSH keys" },
    })

    .post("/ssh-keys", async ({ body }) => ({
      success: true,
      data: await sshKeySvc.registerKey(db, body),
    }), {
      body: AccessModel.registerKeyBody,
      detail: { tags: ["Access"], summary: "Register SSH key" },
    })

    .get("/ssh-keys/:id", async ({ params, set }) => {
      const row = await sshKeySvc.getKey(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: AccessModel.idParams,
      detail: { tags: ["Access"], summary: "Get SSH key" },
    })

    .post("/ssh-keys/:id/revoke", async ({ params, set }) => {
      const row = await sshKeySvc.revokeKey(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: AccessModel.idParams,
      detail: { tags: ["Access"], summary: "Revoke SSH key" },
    })

    .post("/ssh-keys/:id/delete", async ({ params, set }) => {
      const row = await sshKeySvc.deleteKey(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: AccessModel.idParams,
      detail: { tags: ["Access"], summary: "Delete SSH key" },
    })
}
