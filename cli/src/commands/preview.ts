import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import {
  type ColumnOpt,
  apiCall,
  tableOrJson,
  detailView,
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
  timeAgo,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("preview", [
  "$ dx preview deploy                Deploy preview from current branch",
  "$ dx preview list                  List active previews",
  "$ dx preview show my-preview       Show preview details",
  "$ dx preview destroy my-preview    Tear down a preview",
  "$ dx preview open my-preview       Open preview URL in browser",
]);

async function getPreviewApi() {
  const api = await getFactoryClient();
  // Routes: /api/v1/factory/infra/previews/...
  return (api as any).api.v1.factory.infra.previews;
}

export function previewCommand(app: DxBase) {
  return app
    .sub("preview")
    .meta({ description: "Manage preview deployments" })

    // --- deploy ---
    .command("deploy", (c) =>
      c
        .meta({ description: "Deploy a preview from the current branch" })
        .flags({
          branch: {
            type: "string",
            alias: "b",
            description: "Source branch (default: current branch)",
          },
          repo: {
            type: "string",
            description: "Repository URL",
          },
          pr: {
            type: "number",
            description: "PR number",
          },
          site: {
            type: "string",
            description: "Site name for the preview",
          },
          "site-id": {
            type: "string",
            description: "Site ID",
          },
          "cluster-id": {
            type: "string",
            description: "Cluster ID to deploy to",
          },
          "owner-id": {
            type: "string",
            description: "Owner ID",
          },
          auth: {
            type: "string",
            description: "Auth mode (public|team|private, default: team)",
          },
          ttl: {
            type: "string",
            description: "TTL duration (e.g. 7d, 24h)",
          },
          wait: {
            type: "boolean",
            alias: "w",
            description: "Wait for preview to become active (default: true)",
          },
        })
        .run(async ({ flags }) => {
          // Detect current branch if not specified
          let branch = flags.branch as string | undefined;
          if (!branch) {
            try {
              const { captureOrThrow } = await import("../lib/subprocess.js");
              const result = await captureOrThrow(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
              branch = result.stdout.trim();
            } catch {
              console.error("Could not detect current branch. Use --branch to specify.");
              process.exit(1);
            }
          }

          // Get current commit SHA
          let commitSha = "";
          try {
            const { captureOrThrow } = await import("../lib/subprocess.js");
            const result = await captureOrThrow(["git", "rev-parse", "HEAD"]);
            commitSha = result.stdout.trim();
          } catch {
            commitSha = "unknown";
          }

          // Get repo URL if not specified
          let repo = flags.repo as string | undefined;
          if (!repo) {
            try {
              const { captureOrThrow } = await import("../lib/subprocess.js");
              const result = await captureOrThrow(["git", "remote", "get-url", "origin"]);
              repo = result.stdout.trim();
            } catch {
              // repo is optional in the API
            }
          }

          const siteName = (flags.site as string) ?? "default";

          const body: Record<string, unknown> = {
            name: `preview-${branch}`,
            sourceBranch: branch,
            commitSha,
            repo: repo ?? "",
            siteName,
            ownerId: flags["owner-id"] ?? "cli-user",
            createdBy: flags["owner-id"] ?? "cli-user",
          };
          if (flags.pr != null) body.prNumber = flags.pr;
          if (flags["site-id"]) body.siteId = flags["site-id"];
          if (flags["cluster-id"]) body.clusterId = flags["cluster-id"];
          if (flags.auth) body.authMode = flags.auth;

          const api = await getPreviewApi();
          const result = await apiCall(flags, () => api.post(body));

          if (!result?.data?.preview?.slug) {
            actionResult(flags, result, styleSuccess("Preview created."));
            return;
          }

          const slug = result.data.preview.slug as string;
          const domain = result.data.route?.domain as string | undefined;
          const shouldWait = flags.wait !== false;

          if (shouldWait) {
            process.stdout.write(styleMuted("Deploying preview..."));
            const maxWait = 120_000;
            const interval = 3_000;
            const start = Date.now();
            let status = "building";

            while (Date.now() - start < maxWait && !["active", "failed", "expired"].includes(status)) {
              await new Promise((r) => setTimeout(r, interval));
              try {
                const poll = await api({ slug }).get();
                status = poll?.data?.status ?? status;
              } catch {
                // ignore transient errors
              }
              process.stdout.write(".");
            }
            console.log();

            if (status === "active") {
              console.log(styleSuccess(`Preview "${slug}" is active.`));
              if (domain) {
                console.log(styleMuted(`  URL: https://${domain}`));
              }
            } else {
              console.log(styleMuted(`Preview status: ${status}`));
            }
          } else {
            console.log(styleSuccess(`Preview "${slug}" created (deploying in background).`));
            if (domain) {
              console.log(styleMuted(`  URL: https://${domain}`));
            }
          }
        })
    )

    // --- list ---
    .command("list", (c) =>
      c
        .meta({ description: "List previews" })
        .flags({
          all: {
            type: "boolean",
            alias: "a",
            description: "Include expired/inactive previews",
          },
          status: {
            type: "string",
            alias: "s",
            description: "Filter by status",
          },
          repo: {
            type: "string",
            description: "Filter by repo",
          },
          branch: {
            type: "string",
            description: "Filter by source branch",
          },
          "site-id": {
            type: "string",
            description: "Filter by site ID",
          },
        })
        .run(async ({ flags }) => {
          const api = await getPreviewApi();
          const query: Record<string, string | undefined> = {};
          if (!flags.all && !flags.status) query.status = "active";
          if (flags.status) query.status = flags.status as string;
          if (flags.repo) query.repo = flags.repo as string;
          if (flags.branch) query.sourceBranch = flags.branch as string;
          if (flags["site-id"]) query.siteId = flags["site-id"] as string;

          const result = await apiCall(flags, () => api.get({ query }));
          const colOpts: ColumnOpt[] = [{}, {}, {}, {}, {}, {}, {}];
          tableOrJson(
            flags,
            result,
            ["Slug", "Branch", "PR", "Status", "Runtime", "Repo", "Created"],
            (r) => [
              styleBold(String(r.slug ?? "")),
              String(r.sourceBranch ?? ""),
              r.prNumber ? `#${r.prNumber}` : "-",
              colorStatus(String(r.status ?? "")),
              String(r.runtimeClass ?? ""),
              styleMuted(String(r.repo ?? "").replace(/.*\//, "")),
              timeAgo(r.createdAt as string),
            ],
            colOpts,
            { emptyMessage: "No previews found." },
          );
        })
    )

    // --- show ---
    .command("show", (c) =>
      c
        .meta({ description: "Show preview details" })
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Preview slug",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getPreviewApi();
          const result = await apiCall(flags, () =>
            api({ slug: args.slug }).get()
          );
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.previewId ?? ""))],
            ["Slug", (r) => styleBold(String(r.slug ?? ""))],
            ["Branch", (r) => String(r.sourceBranch ?? "")],
            ["PR", (r) => r.prNumber ? `#${r.prNumber}` : "-"],
            ["Commit", (r) => styleMuted(String(r.commitSha ?? "").slice(0, 8))],
            ["Repo", (r) => String(r.repo ?? "")],
            ["Status", (r) => colorStatus(String(r.status ?? ""))],
            ["Runtime", (r) => String(r.runtimeClass ?? "")],
            ["Auth", (r) => String(r.authMode ?? "")],
            ["Owner", (r) => String(r.ownerId ?? "")],
            ["URL", (r) => `https://${r.slug}.preview.dx.dev`],
            ["Expires", (r) => r.expiresAt ? timeAgo(r.expiresAt as string) : "-"],
            ["Created", (r) => timeAgo(r.createdAt as string)],
          ]);
        })
    )

    // --- destroy ---
    .command("destroy", (c) =>
      c
        .meta({ description: "Destroy a preview" })
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Preview slug",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getPreviewApi();
          const result = await apiCall(flags, () =>
            api({ slug: args.slug }).delete()
          );
          actionResult(flags, result, styleSuccess(`Preview "${args.slug}" destroyed.`));
        })
    )

    // --- open ---
    .command("open", (c) =>
      c
        .meta({ description: "Open preview URL in browser" })
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Preview slug",
          },
        ])
        .run(async ({ args }) => {
          const url = `https://${args.slug}.preview.dx.dev`;
          const { exec: execCmd } = await import("../lib/subprocess.js");
          const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
          try {
            await execCmd([openCmd, url]);
          } catch {
            console.log(`Open in browser: ${url}`);
          }
        })
    );
}
