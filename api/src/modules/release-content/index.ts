import { Elysia } from "elysia";
import type { Database } from "../../db/connection";
import { ReleaseContentModel } from "./model";
import { ReleaseContentService } from "./service";
import { releaseContentConfigSchema } from "@smp/factory-shared/release-content-schema";
import { logger } from "../../logger";

export function releaseContentController(db: Database) {
  const service = new ReleaseContentService(db);

  return new Elysia({ prefix: "/release-content" })
    .post(
      "/releases/:version/generate",
      async ({ params, body, set }) => {
        try {
          const config = releaseContentConfigSchema.parse({
            outputs: body.outputs,
            changelogPath: body.changelogPath,
            docsDir: body.docsDir,
            repoFullName: body.repoFullName,
          });

          return await service.generateForRelease(params.version, config);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);

          logger.error({ err, version: params.version }, "Release content generation failed");

          // Map known error types to HTTP status codes
          if (message.includes("not found")) {
            set.status = 404;
            return { error: message };
          }
          if (message.includes("required")) {
            set.status = 400;
            return { error: message };
          }
          if (message.includes("No commits or PRs")) {
            set.status = 422;
            return { error: message };
          }
          if (message.includes("No content was generated")) {
            set.status = 502;
            return { error: message };
          }

          set.status = 500;
          return { error: "Internal error during release content generation" };
        }
      },
      {
        params: ReleaseContentModel.versionParams,
        body: ReleaseContentModel.generateBody,
        detail: {
          tags: ["Release Content"],
          summary: "Generate release content (changelog, notes, docs)",
          description:
            "Collects commits, PRs, OpenAPI diffs, and design specs for the given " +
            "release version, generates multi-audience documentation via LLM, and " +
            "opens a draft PR with the generated files.",
        },
      },
    );
}
