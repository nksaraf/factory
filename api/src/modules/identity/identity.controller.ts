import { Elysia } from "elysia";
import { createHash } from "node:crypto";

import type { Database } from "../../db/connection";
import type { AuthUser } from "../../plugins/auth.plugin";
import { IdentityModel } from "./model";
import { IdentityService } from "./identity.service";

export function identityController(db: Database) {
  const svc = new IdentityService(db);

  return new Elysia({ prefix: "/identity" })
    // ─── Me ─────────────────────────────────────────────────
    .get(
      "/me",
      async (ctx) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const identities = await svc.getLinkedIdentities(
          principal.principalId,
        );
        return { success: true, data: { ...principal, identities } };
      },
      { detail: { tags: ["Identity"], summary: "Get current principal" } },
    )

    // ─── Identity Links ─────────────────────────────────────
    .get(
      "/me/identities",
      async (ctx) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const data = await svc.getLinkedIdentities(principal.principalId);
        return { success: true, data };
      },
      { detail: { tags: ["Identity"], summary: "List linked identities" } },
    )
    .post(
      "/me/identities/:provider/link",
      async ({ params, body, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.resolveOrCreatePrincipal({
          authUserId: user.id,
          email: user.email,
        });
        const row = await svc.linkIdentity(
          principal.principalId,
          params.provider,
          body,
        );
        await svc.refreshPrincipalProfile(principal.principalId);
        return { success: true, data: row };
      },
      {
        params: IdentityModel.providerParams,
        body: IdentityModel.linkIdentityBody,
        detail: { tags: ["Identity"], summary: "Link identity provider" },
      },
    )
    .delete(
      "/me/identities/:provider",
      async ({ params, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        await svc.unlinkIdentity(principal.principalId, params.provider);
        await svc.refreshPrincipalProfile(principal.principalId);
        return { success: true };
      },
      {
        params: IdentityModel.providerParams,
        detail: { tags: ["Identity"], summary: "Unlink identity provider" },
      },
    )

    // ─── Profile ────────────────────────────────────────────
    .patch(
      "/me/profile",
      async ({ body, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const profile = await svc.updateProfileOverrides(
          principal.principalId,
          body,
        );
        return { success: true, data: profile };
      },
      {
        body: IdentityModel.updateProfileBody,
        detail: { tags: ["Identity"], summary: "Update profile overrides" },
      },
    )

    // ─── Tool Credentials ───────────────────────────────────
    .post(
      "/me/tool-credentials",
      async ({ body, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        // Hash the key with sha256 for storage
        const keyHash = createHash("sha256").update(body.key).digest("hex");
        const row = await svc.createToolCredential(principal.principalId, {
          provider: body.provider,
          keyName: body.keyName,
          keyHash,
        });
        return { success: true, data: row };
      },
      {
        body: IdentityModel.createToolCredentialBody,
        detail: { tags: ["Identity"], summary: "Register tool credential" },
      },
    )
    .get(
      "/me/tool-credentials",
      async (ctx) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const data = await svc.listToolCredentials(principal.principalId);
        return { success: true, data };
      },
      { detail: { tags: ["Identity"], summary: "List tool credentials" } },
    )
    .delete(
      "/me/tool-credentials/:id",
      async ({ params, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const row = await svc.revokeToolCredential(
          principal.principalId,
          params.id,
        );
        if (!row) {
          ctx.set.status = 404;
          return { success: false, error: "not_found" };
        }
        return { success: true, data: row };
      },
      {
        params: IdentityModel.idParams,
        detail: { tags: ["Identity"], summary: "Revoke tool credential" },
      },
    )

    // ─── Tool Usage ─────────────────────────────────────────
    .post(
      "/me/tool-usage",
      async ({ body, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const row = await svc.reportToolUsage(principal.principalId, body);
        return { success: true, data: row };
      },
      {
        body: IdentityModel.reportToolUsageBody,
        detail: { tags: ["Identity"], summary: "Report tool usage" },
      },
    )
    .get(
      "/me/tool-usage",
      async ({ query, ...ctx }) => {
        const user = (ctx as unknown as { user: AuthUser }).user;
        const principal = await svc.getPrincipalByAuthUserId(user.id);
        if (!principal) {
          ctx.set.status = 404;
          return { success: false, error: "principal_not_found" };
        }
        const result = await svc.queryToolUsage(
          principal.principalId,
          query,
        );
        return { success: true, ...result };
      },
      {
        query: IdentityModel.toolUsageQuery,
        detail: { tags: ["Identity"], summary: "Query tool usage" },
      },
    );
}
