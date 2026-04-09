/**
 * v2 Org controller.
 *
 * Maps org-level routes to v2 ontology tables:
 *   /org/teams        → org.team
 *   /org/principals   → org.principal
 *   /org/scopes       → org.scope
 */
import {
  CreateEntityRelationshipSchema,
  CreatePrincipalSchema,
  CreateScopeSchema,
  CreateTeamSchema,
  UpdateEntityRelationshipSchema,
  UpdatePrincipalSchema,
  UpdateScopeSchema,
  UpdateTeamSchema,
} from "@smp/factory-shared/schemas/org"
import { and, eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { z } from "zod"

import type { Database } from "../../db/connection"
import {
  entityRelationship,
  identityLink,
  membership,
  principal,
  scope,
  sshKey,
  team,
} from "../../db/schema/org-v2"
import { ontologyRoutes } from "../../lib/crud"
import { newId } from "../../lib/id"
import { PostgresSecretBackend } from "../../lib/secrets/postgres-backend"
import { IdentitySyncService } from "./identity-sync.service"
import { IdentityService } from "./identity.service"

const LinkIdentityBody = z.object({
  type: z.string().min(1),
  externalId: z.string().min(1),
  displayName: z.string().optional(),
})
type LinkIdentityBody = z.infer<typeof LinkIdentityBody>

const UnlinkIdentityBody = z.object({
  provider: z.string().min(1),
})
type UnlinkIdentityBody = z.infer<typeof UnlinkIdentityBody>

const MergePrincipalBody = z.object({
  duplicateId: z.string().min(1),
})
type MergePrincipalBody = z.infer<typeof MergePrincipalBody>

const AddSshKeyBody = z.object({
  type: z.enum(["ed25519", "rsa", "ecdsa"]),
  fingerprint: z.string().min(1),
  publicKey: z.string().optional(),
})
type AddSshKeyBody = z.infer<typeof AddSshKeyBody>

export function identityControllerV2(db: Database) {
  return (
    new Elysia({ prefix: "/org" })

      // ── Teams ──────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "teams",
          singular: "team",
          table: team,
          slugColumn: team.slug,
          idColumn: team.id,
          createSchema: CreateTeamSchema,
          updateSchema: UpdateTeamSchema,
          deletable: "bitemporal",
          bitemporal: { validTo: team.validTo, systemTo: team.systemTo },
          relations: {
            members: {
              path: "members",
              table: membership,
              fk: membership.teamId,
            },
          },
        })
      )

      // ── Principals ─────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "principals",
          singular: "principal",
          table: principal,
          slugColumn: principal.slug,
          idColumn: principal.id,
          createSchema: CreatePrincipalSchema,
          updateSchema: UpdatePrincipalSchema,
          deletable: "bitemporal",
          bitemporal: {
            validTo: principal.validTo,
            systemTo: principal.systemTo,
          },
          relations: {
            identities: {
              path: "identities",
              table: identityLink,
              fk: identityLink.principalId,
            },
            "ssh-keys": {
              path: "ssh-keys",
              table: sshKey,
              fk: sshKey.principalId,
            },
            memberships: {
              path: "memberships",
              table: membership,
              fk: membership.principalId,
            },
          },
          actions: {
            "link-identity": {
              bodySchema: LinkIdentityBody,
              handler: async ({ db, entity, body }) => {
                const b = body as LinkIdentityBody
                const [link] = await db
                  .insert(identityLink)
                  .values({
                    id: newId("idlk"),
                    principalId: entity.id as string,
                    type: b.type,
                    externalId: b.externalId,
                    spec: { displayName: b.displayName } as any,
                  })
                  .returning()
                return link
              },
            },
            "unlink-identity": {
              bodySchema: UnlinkIdentityBody,
              handler: async ({ db, entity, body }) => {
                const b = body as UnlinkIdentityBody
                const deleted = await db
                  .delete(identityLink)
                  .where(
                    and(
                      eq(identityLink.principalId, entity.id as string),
                      eq(identityLink.type, b.provider)
                    )
                  )
                  .returning()
                return { removed: deleted.length }
              },
            },
            merge: {
              bodySchema: MergePrincipalBody,
              handler: async ({ db, entity, body }) => {
                const b = body as MergePrincipalBody
                const svc = new IdentityService(db)
                const moved = await svc.mergePrincipals(
                  entity.id as string,
                  b.duplicateId
                )
                return { kept: entity.id, merged: b.duplicateId, moved }
              },
            },
            "add-ssh-key": {
              bodySchema: AddSshKeyBody,
              handler: async ({ db, entity, body }) => {
                const b = body as AddSshKeyBody
                const [key] = await db
                  .insert(sshKey)
                  .values({
                    id: newId("sshk"),
                    principalId: entity.id as string,
                    type: b.type,
                    fingerprint: b.fingerprint,
                    spec: { publicKey: b.publicKey } as any,
                  })
                  .returning()
                return key
              },
            },
          },
        })
      )

      // ── Scopes ─────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "scopes",
          singular: "scope",
          table: scope,
          slugColumn: scope.slug,
          idColumn: scope.id,
          createSchema: CreateScopeSchema,
          updateSchema: UpdateScopeSchema,
          deletable: true,
        })
      )

      // ── Entity Relationships ──────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "entity-relationships",
          singular: "entity relationship",
          table: entityRelationship,
          slugColumn: entityRelationship.id,
          idColumn: entityRelationship.id,
          createSchema: CreateEntityRelationshipSchema,
          updateSchema: UpdateEntityRelationshipSchema,
          deletable: true,
        })
      )

      // ── Identity Sync ─────────────────────────────────────
      .post("/sync/identities", async () => {
        const secrets = new PostgresSecretBackend(db)
        const svc = new IdentitySyncService(db, secrets)
        const results = await svc.syncAllIdentities()
        return { status: "ok", data: results }
      })

      // ── Identity Export / Import ──────────────────────────────
      .get("/sync/identities/export/:provider", async ({ params }) => {
        const provider =
          params.provider as import("../../adapters/identity-provider-adapter").IdentityProviderType
        const secrets = new PostgresSecretBackend(db)
        const svc = new IdentitySyncService(db, secrets)
        const users = await svc.exportUsers(provider)
        return { status: "ok", provider, count: users.length, data: users }
      })
      .post("/sync/identities/import/:provider", async ({ params, body }) => {
        const provider =
          params.provider as import("../../adapters/identity-provider-adapter").IdentityProviderType
        const { data } = body as {
          data: import("../../adapters/identity-provider-adapter").ExternalIdentityUser[]
        }
        const secrets = new PostgresSecretBackend(db)
        const svc = new IdentitySyncService(db, secrets)
        const result = await svc.importUsers(provider, data)
        return { status: "ok", ...result }
      })
  )
}
