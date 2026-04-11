import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { BuildModel } from "./model"
import { GitHostService } from "./git-host.service"

export function gitHostController(db: Database) {
  const svc = new GitHostService(db)

  return new Elysia({ prefix: "/git-host-provider" })
    .post(
      "/",
      async ({ body }) => {
        const row = await svc.createProvider(body)
        return { success: true, data: row }
      },
      {
        body: BuildModel.createGitHostProviderBody,
        detail: { tags: ["Build"], summary: "Create git host provider" },
      }
    )
    .get(
      "/",
      async ({ query }) => ({
        success: true,
        ...(await svc.listProviders({
          limit: query.limit,
          offset: query.offset,
        })),
      }),
      {
        query: BuildModel.listGitHostProvidersQuery,
        detail: { tags: ["Build"], summary: "List git host providers" },
      }
    )
    .get(
      "/:id",
      async ({ params, set }) => {
        const row = await svc.getProvider(params.id)
        if (!row) {
          set.status = 404
          return { success: false, error: "not_found" }
        }
        return { success: true, data: row }
      },
      {
        params: BuildModel.idParams,
        detail: { tags: ["Build"], summary: "Get git host provider" },
      }
    )
    .post(
      "/:id/update",
      async ({ params, body, set }) => {
        const row = await svc.updateProvider(params.id, body)
        if (!row) {
          set.status = 404
          return { success: false, error: "not_found" }
        }
        return { success: true, data: row }
      },
      {
        params: BuildModel.idParams,
        body: BuildModel.updateGitHostProviderBody,
        detail: { tags: ["Build"], summary: "Update git host provider" },
      }
    )
    .post(
      "/:id/delete",
      async ({ params }) => {
        await svc.deleteProvider(params.id)
        return { success: true }
      },
      {
        params: BuildModel.idParams,
        detail: { tags: ["Build"], summary: "Delete git host provider" },
      }
    )
    .post(
      "/:id/sync",
      async ({ params, set }) => {
        try {
          const result = await svc.triggerFullSync(params.id)
          return { success: true, data: result }
        } catch (err) {
          set.status = 400
          return {
            success: false,
            error: err instanceof Error ? err.message : "sync_failed",
          }
        }
      },
      {
        params: BuildModel.idParams,
        detail: { tags: ["Build"], summary: "Trigger git host sync" },
      }
    )
    .get(
      "/:id/repos/:repoSlug/pulls",
      async ({ params, query, set }) => {
        try {
          const data = await svc.listPullRequests(params.id, params.repoSlug, {
            state: query.state,
          })
          return { success: true, data }
        } catch (err) {
          set.status = 400
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed",
          }
        }
      },
      {
        params: BuildModel.repoSlugParams,
        query: BuildModel.listPullRequestsQuery,
        detail: { tags: ["Build"], summary: "List pull requests" },
      }
    )
    .post(
      "/:id/repos/:repoSlug/pulls",
      async ({ params, body, set }) => {
        try {
          const data = await svc.createPullRequest(
            params.id,
            params.repoSlug,
            body
          )
          return { success: true, data }
        } catch (err) {
          set.status = 400
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed",
          }
        }
      },
      {
        params: BuildModel.repoSlugParams,
        body: BuildModel.createPullRequestBody,
        detail: { tags: ["Build"], summary: "Create pull request" },
      }
    )
    .get(
      "/:id/repos/:repoSlug/pulls/:prNumber",
      async ({ params, set }) => {
        try {
          const data = await svc.getPullRequest(
            params.id,
            params.repoSlug,
            params.prNumber
          )
          if (!data) {
            set.status = 404
            return { success: false, error: "not_found" }
          }
          return { success: true, data }
        } catch (err) {
          set.status = 400
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed",
          }
        }
      },
      {
        params: BuildModel.prParams,
        detail: { tags: ["Build"], summary: "Get pull request" },
      }
    )
    .post(
      "/:id/repos/:repoSlug/pulls/:prNumber/merge",
      async ({ params, body, set }) => {
        try {
          await svc.mergePullRequest(
            params.id,
            params.repoSlug,
            params.prNumber,
            body.method
          )
          return { success: true }
        } catch (err) {
          set.status = 400
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed",
          }
        }
      },
      {
        params: BuildModel.prParams,
        body: BuildModel.mergePullRequestBody,
        detail: { tags: ["Build"], summary: "Merge pull request" },
      }
    )
    .get(
      "/:id/repos/:repoSlug/pulls/:prNumber/checks",
      async ({ params, set }) => {
        try {
          const data = await svc.getPullRequestChecks(
            params.id,
            params.repoSlug,
            params.prNumber
          )
          return { success: true, data }
        } catch (err) {
          set.status = 400
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed",
          }
        }
      },
      {
        params: BuildModel.prParams,
        detail: { tags: ["Build"], summary: "Get pull request checks" },
      }
    )
}
