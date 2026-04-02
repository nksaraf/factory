import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import * as agentSvc from "./service";
import * as presetSvc from "./preset.service";
import * as jobSvc from "./job.model";

// ---------------------------------------------------------------------------
// Validation models
// ---------------------------------------------------------------------------

const AgentModel = {
  idParams: t.Object({ id: t.String() }),
  createBody: t.Object({
    name: t.String(),
    agentType: t.Optional(t.String()),
    rolePresetSlug: t.Optional(t.String()),
    autonomyLevel: t.Optional(t.String()),
    relationship: t.Optional(t.String()),
    relationshipEntityId: t.Optional(t.String()),
    collaborationMode: t.Optional(t.String()),
    reportsToAgentId: t.Optional(t.String()),
    principalId: t.Optional(t.String()),
    capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
    config: t.Optional(t.Record(t.String(), t.Unknown())),
    guardrails: t.Optional(t.Record(t.String(), t.Unknown())),
  }),
  updateBody: t.Object({
    name: t.Optional(t.String()),
    status: t.Optional(t.String()),
    rolePresetSlug: t.Optional(t.String()),
    autonomyLevel: t.Optional(t.String()),
    relationship: t.Optional(t.String()),
    relationshipEntityId: t.Optional(t.String()),
    collaborationMode: t.Optional(t.String()),
    reportsToAgentId: t.Optional(t.String()),
    capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
    config: t.Optional(t.Record(t.String(), t.Unknown())),
    trustScore: t.Optional(t.Number()),
    guardrails: t.Optional(t.Record(t.String(), t.Unknown())),
  }),
  listQuery: t.Object({
    status: t.Optional(t.String()),
    relationship: t.Optional(t.String()),
    rolePresetSlug: t.Optional(t.String()),
  }),
};

const PresetModel = {
  idParams: t.Object({ id: t.String() }),
  createBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    orgId: t.Optional(t.String()),
    description: t.Optional(t.String()),
    defaults: t.Record(t.String(), t.Unknown()),
  }),
  updateBody: t.Object({
    name: t.Optional(t.String()),
    description: t.Optional(t.String()),
    defaults: t.Optional(t.Record(t.String(), t.Unknown())),
  }),
  listQuery: t.Object({
    orgId: t.Optional(t.String()),
  }),
};

const JobModel = {
  idParams: t.Object({ id: t.String() }),
  createBody: t.Object({
    agentId: t.String(),
    mode: t.String(),
    trigger: t.String(),
    task: t.String(),
    entityKind: t.Optional(t.String()),
    entityId: t.Optional(t.String()),
    channelKind: t.Optional(t.String()),
    channelId: t.Optional(t.String()),
    messageThreadId: t.Optional(t.String()),
    parentJobId: t.Optional(t.String()),
    delegatedByAgentId: t.Optional(t.String()),
    metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  }),
  completeBody: t.Object({
    outcome: t.Optional(t.Record(t.String(), t.Unknown())),
    costCents: t.Optional(t.Number()),
  }),
  failBody: t.Object({
    outcome: t.Optional(t.Record(t.String(), t.Unknown())),
  }),
  overrideBody: t.Object({
    note: t.String(),
  }),
  listQuery: t.Object({
    agentId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    mode: t.Optional(t.String()),
    trigger: t.Optional(t.String()),
    entityKind: t.Optional(t.String()),
    entityId: t.Optional(t.String()),
    parentJobId: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    offset: t.Optional(t.Number()),
  }),
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function agentController(db: Database) {
  return new Elysia({ prefix: "/agent" })

    // ── Agents ──
    .get("/agents", async ({ query }) => ({
      success: true,
      ...(await agentSvc.listAgents(db, query)),
    }), {
      query: AgentModel.listQuery,
      detail: { tags: ["Agent"], summary: "List agents" },
    })
    .post("/agents", async ({ body }) => ({
      success: true,
      data: await agentSvc.createAgent(db, body),
    }), {
      body: AgentModel.createBody,
      detail: { tags: ["Agent"], summary: "Create agent" },
    })
    .get("/agents/:id", async ({ params, set }) => {
      const data = await agentSvc.getAgent(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: AgentModel.idParams,
      detail: { tags: ["Agent"], summary: "Get agent" },
    })
    .post("/agents/:id/update", async ({ params, body, set }) => {
      const data = await agentSvc.updateAgent(db, params.id, body);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: AgentModel.idParams,
      body: AgentModel.updateBody,
      detail: { tags: ["Agent"], summary: "Update agent" },
    })
    .post("/agents/:id/delete", async ({ params, set }) => {
      const data = await agentSvc.deleteAgent(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: AgentModel.idParams,
      detail: { tags: ["Agent"], summary: "Disable agent" },
    })

    // ── Role Presets ──
    .get("/presets", async ({ query }) => ({
      success: true,
      ...(await presetSvc.listRolePresets(db, query)),
    }), {
      query: PresetModel.listQuery,
      detail: { tags: ["Agent"], summary: "List role presets" },
    })
    .post("/presets", async ({ body }) => ({
      success: true,
      data: await presetSvc.createRolePreset(db, body),
    }), {
      body: PresetModel.createBody,
      detail: { tags: ["Agent"], summary: "Create role preset" },
    })
    .get("/presets/:id", async ({ params, set }) => {
      const data = await presetSvc.getRolePreset(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: PresetModel.idParams,
      detail: { tags: ["Agent"], summary: "Get role preset" },
    })
    .post("/presets/:id/update", async ({ params, body, set }) => {
      const data = await presetSvc.updateRolePreset(db, params.id, body);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: PresetModel.idParams,
      body: PresetModel.updateBody,
      detail: { tags: ["Agent"], summary: "Update role preset" },
    })
    .post("/presets/:id/delete", async ({ params }) => {
      await presetSvc.deleteRolePreset(db, params.id);
      return { success: true };
    }, {
      params: PresetModel.idParams,
      detail: { tags: ["Agent"], summary: "Delete role preset" },
    })

    // ── Jobs ──
    .get("/jobs", async ({ query }) => ({
      success: true,
      ...(await jobSvc.listJobs(db, query)),
    }), {
      query: JobModel.listQuery,
      detail: { tags: ["Agent"], summary: "List jobs" },
    })
    .post("/jobs", async ({ body }) => ({
      success: true,
      data: await jobSvc.createJob(db, body),
    }), {
      body: JobModel.createBody,
      detail: { tags: ["Agent"], summary: "Create job" },
    })
    .get("/jobs/:id", async ({ params, set }) => {
      const data = await jobSvc.getJob(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: JobModel.idParams,
      detail: { tags: ["Agent"], summary: "Get job" },
    })
    .post("/jobs/:id/start", async ({ params, set }) => {
      const data = await jobSvc.startJob(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: JobModel.idParams,
      detail: { tags: ["Agent"], summary: "Start job" },
    })
    .post("/jobs/:id/complete", async ({ params, body, set }) => {
      const data = await jobSvc.completeJob(
        db,
        params.id,
        body.outcome,
        body.costCents,
      );
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: JobModel.idParams,
      body: JobModel.completeBody,
      detail: { tags: ["Agent"], summary: "Complete job" },
    })
    .post("/jobs/:id/fail", async ({ params, body, set }) => {
      const data = await jobSvc.failJob(db, params.id, body.outcome);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: JobModel.idParams,
      body: JobModel.failBody,
      detail: { tags: ["Agent"], summary: "Fail job" },
    })
    .post("/jobs/:id/cancel", async ({ params, set }) => {
      const data = await jobSvc.cancelJob(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: JobModel.idParams,
      detail: { tags: ["Agent"], summary: "Cancel job" },
    })
    .post("/jobs/:id/override", async ({ params, body, set }) => {
      const data = await jobSvc.overrideJob(db, params.id, body.note);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: JobModel.idParams,
      body: JobModel.overrideBody,
      detail: { tags: ["Agent"], summary: "Override job" },
    });
}
