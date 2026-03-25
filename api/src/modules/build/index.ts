import { Elysia, t } from "elysia";

import { parseConventionsInput } from "@smp/factory-shared/conventions-schema";
import {
  validateBranchName,
  validateCommitMessage,
} from "@smp/factory-shared/conventions";

import type { Database } from "../../db/connection";
import { BuildModel } from "./model";
import { BuildPlaneService } from "./plane.service";
import { BuildService } from "./service";

export function buildController(db: Database) {
  const plane = new BuildPlaneService(db);

  return new Elysia({ prefix: "/build" })
    .post(
      "/builds",
      ({ body }) => BuildService.triggerBuild(body),
      {
        body: BuildModel.triggerBuildBody,
        detail: { tags: ["Build"], summary: "Trigger build" },
      }
    )
    .get(
      "/builds/:id",
      ({ params }) => BuildService.getBuild(params.id),
      {
        params: BuildModel.idParams,
        detail: { tags: ["Build"], summary: "Get build" },
      }
    )
    .post(
      "/repos",
      async ({ body }) => {
        const row = await plane.createRepo(body);
        return { success: true, data: row };
      },
      {
        body: BuildModel.createRepoBody,
        detail: { tags: ["Build"], summary: "Create repo" },
      }
    )
    .get(
      "/repos",
      async ({ query }) => ({
        success: true,
        ...(await plane.listRepos({
          moduleId: query.moduleId,
          limit: query.limit,
          offset: query.offset,
        })),
      }),
      {
        query: BuildModel.listReposQuery,
        detail: { tags: ["Build"], summary: "List repos" },
      }
    )
    .get(
      "/repos/:id",
      async ({ params, set }) => {
        const row = await plane.getRepo(params.id);
        if (!row) {
          set.status = 404;
          return { success: false, error: "not_found" };
        }
        return { success: true, data: row };
      },
      {
        params: BuildModel.idParams,
        detail: { tags: ["Build"], summary: "Get repo" },
      }
    )
    .post(
      "/modules/:name/versions",
      async ({ params, body, set }) => {
        try {
          const row = await plane.createModuleVersion(params.name, body);
          return { success: true, data: row };
        } catch {
          set.status = 404;
          return { success: false, error: "module_not_found" };
        }
      },
      {
        params: BuildModel.moduleNameParams,
        body: BuildModel.registerVersionBody,
        detail: { tags: ["Build"], summary: "Register module version" },
      }
    )
    .get(
      "/modules/:name/versions",
      async ({ params }) => ({
        success: true,
        ...(await plane.listModuleVersions(params.name)),
      }),
      {
        params: BuildModel.moduleNameParams,
        detail: { tags: ["Build"], summary: "List module versions" },
      }
    )
    .post(
      "/artifacts",
      async ({ body }) => {
        const row = await plane.createArtifact(body);
        return { success: true, data: row };
      },
      {
        body: BuildModel.createArtifactBody,
        detail: { tags: ["Build"], summary: "Create artifact" },
      }
    )
    .get(
      "/artifacts",
      async ({ query }) => ({
        success: true,
        ...(await plane.listArtifacts({
          limit: query.limit,
          offset: query.offset,
        })),
      }),
      {
        query: BuildModel.listArtifactsQuery,
        detail: { tags: ["Build"], summary: "List artifacts" },
      }
    )
    .get(
      "/artifacts/:id",
      async ({ params, set }) => {
        const row = await plane.getArtifact(params.id);
        if (!row) {
          set.status = 404;
          return { success: false, error: "not_found" };
        }
        return { success: true, data: row };
      },
      {
        params: BuildModel.idParams,
        detail: { tags: ["Build"], summary: "Get artifact" },
      }
    )
    .post(
      "/component-artifacts",
      async ({ body, set }) => {
        try {
          const row = await plane.linkComponentArtifact(body);
          return { success: true, data: row };
        } catch {
          set.status = 400;
          return { success: false, error: "link_failed" };
        }
      },
      {
        body: BuildModel.linkComponentArtifactBody,
        detail: { tags: ["Build"], summary: "Link component artifact" },
      }
    )
    .get(
      "/modules/:name/versions/:versionId/component-artifacts",
      async ({ params }) => {
        const rows = await plane.getComponentArtifacts(params.versionId);
        return { success: true, data: rows };
      },
      {
        params: t.Object({
          name: t.String(),
          versionId: t.String(),
        }),
        detail: {
          tags: ["Build"],
          summary: "List component artifacts for a module version",
        },
      }
    )
    .post(
      "/conventions/validate",
      ({ body }) => {
        const config = parseConventionsInput(body.conventions);
        const result =
          body.type === "branch"
            ? validateBranchName(body.value, config)
            : validateCommitMessage(body.value, config);
        return { success: true, data: result };
      },
      {
        body: BuildModel.validateConventionBody,
        detail: {
          tags: ["Build"],
          summary: "Validate branch or commit conventions",
        },
      }
    );
}
