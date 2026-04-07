import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import * as svc from "./messaging.service";

const MessagingModel = {
  createProviderBody: t.Object({
    name: t.String(),
    type: t.String(),
    teamId: t.String(),
    workspaceId: t.Optional(t.String()),
    botToken: t.Optional(t.String()),
    signingSecret: t.Optional(t.String()),
  }),
  providerIdParams: t.Object({ id: t.String() }),
  mapChannelBody: t.Object({
    externalChannelId: t.String(),
    externalChannelName: t.Optional(t.String()),
    entityKind: t.String(),
    entityId: t.String(),
    isDefault: t.Optional(t.Boolean()),
  }),
  channelMappingIdParams: t.Object({ id: t.String(), mapId: t.String() }),
  threadIdParams: t.Object({ id: t.String(), threadId: t.String() }),
  linkUserBody: t.Object({
    externalUserId: t.String(),
    principalId: t.String(),
  }),
  unlinkUserParams: t.Object({ id: t.String(), linkId: t.String() }),
};

export function messagingController(db: Database) {
  return new Elysia({ prefix: "/messaging" })

    // --- Providers ---
    .post("/providers", async ({ body }) => ({
      success: true,
      data: await svc.createMessagingProvider(db, body),
    }), {
      body: MessagingModel.createProviderBody,
      detail: { tags: ["Messaging"], summary: "Register messaging provider" },
    })
    .get("/providers", async () => ({
      success: true,
      ...(await svc.listMessagingProviders(db)),
    }), {
      detail: { tags: ["Messaging"], summary: "List messaging providers" },
    })
    .get("/providers/:id", async ({ params, set }) => {
      const data = await svc.getMessagingProvider(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MessagingModel.providerIdParams,
      detail: { tags: ["Messaging"], summary: "Get messaging provider" },
    })
    .post("/providers/:id/test", async ({ params }) => ({
      success: true,
      ...(await svc.testMessagingProviderConnection(db, params.id)),
    }), {
      params: MessagingModel.providerIdParams,
      detail: { tags: ["Messaging"], summary: "Test provider connection" },
    })
    .post("/providers/:id/sync-users", async ({ params }) => ({
      success: true,
      ...(await svc.syncProviderUsers(db, params.id)),
    }), {
      params: MessagingModel.providerIdParams,
      detail: { tags: ["Messaging"], summary: "Sync provider users" },
    })

    // --- Channel Mappings ---
    .post("/providers/:id/channels", async ({ params, body }) => ({
      success: true,
      data: await svc.mapChannel(db, {
        messagingProviderId: params.id,
        ...body,
      }),
    }), {
      params: MessagingModel.providerIdParams,
      body: MessagingModel.mapChannelBody,
      detail: { tags: ["Messaging"], summary: "Map channel to entity" },
    })
    .get("/providers/:id/channels", async ({ params }) => ({
      success: true,
      ...(await svc.listChannelMappings(db, params.id)),
    }), {
      params: MessagingModel.providerIdParams,
      detail: { tags: ["Messaging"], summary: "List channel mappings" },
    })
    .post("/providers/:id/channels/:mapId/delete", async ({ params }) => {
      await svc.unmapChannel(db, params.mapId);
      return { success: true };
    }, {
      params: MessagingModel.channelMappingIdParams,
      detail: { tags: ["Messaging"], summary: "Remove channel mapping" },
    })

    // --- Message Threads ---
    .get("/providers/:id/threads", async ({ params }) => ({
      success: true,
      ...(await svc.listThreads(db, params.id)),
    }), {
      params: MessagingModel.providerIdParams,
      detail: { tags: ["Messaging"], summary: "List message threads" },
    })
    .get("/providers/:id/threads/:threadId", async ({ params, set }) => {
      const data = await svc.getThread(db, params.threadId);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MessagingModel.threadIdParams,
      detail: { tags: ["Messaging"], summary: "Get message thread" },
    })

    // --- User Linking ---
    .post("/providers/:id/users/link", async ({ params, body }) => {
      const provider = await svc.getMessagingProvider(db, params.id);
      if (!provider) return { success: false, error: "provider_not_found" };
      await svc.linkMessagingUser(
        db,
        provider.type,
        body.externalUserId,
        body.principalId,
      );
      return { success: true };
    }, {
      params: MessagingModel.providerIdParams,
      body: MessagingModel.linkUserBody,
      detail: { tags: ["Messaging"], summary: "Link messaging user to principal" },
    })
    .post("/providers/:id/users/link/:linkId/delete", async ({ params }) => {
      const provider = await svc.getMessagingProvider(db, params.id);
      if (!provider) return { success: false, error: "provider_not_found" };
      await svc.unlinkMessagingUser(db, provider.type, params.linkId);
      return { success: true };
    }, {
      params: MessagingModel.unlinkUserParams,
      detail: { tags: ["Messaging"], summary: "Unlink messaging user" },
    });
}
