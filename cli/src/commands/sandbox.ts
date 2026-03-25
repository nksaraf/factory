import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { toDxFlags } from "./dx-flags.js";
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

// Eden client type doesn't include sandbox routes due to conditional plugin
// registration in factory.api.ts. Routes work at runtime. Use `any` for path access.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSandboxApi(): Promise<any> {
  return getFactoryClient();
}

export function sandboxCommand(app: DxBase) {
  return app
    .sub("sandbox")
    .meta({ description: "Manage sandboxes" })

    // --- create ---
    .command("create", (c) =>
      c
        .meta({ description: "Create a sandbox" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Sandbox name",
          },
        ])
        .flags({
          type: {
            type: "string",
            description: "Runtime type (container|vm)",
          },
          template: {
            type: "string",
            description: "Sandbox template slug",
          },
          ttl: {
            type: "number",
            description: "TTL in minutes (default from template)",
          },
          cpu: {
            type: "string",
            description: 'CPU spec (e.g. "2000m")',
          },
          memory: {
            type: "string",
            description: 'Memory spec (e.g. "4Gi")',
          },
          storage: {
            type: "number",
            description: "PVC size in GB",
          },
          repo: {
            type: "string",
            description: "Repo URL to clone (repeatable)",
          },
          branch: {
            type: "string",
            description: "Branch for repo",
          },
          "owner-id": {
            type: "string",
            description: "Owner ID",
          },
          "owner-type": {
            type: "string",
            description: "Owner type (user|agent)",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const body: Record<string, unknown> = { name: args.name };
          if (flags.type) body.runtimeType = flags.type;
          if (flags.template) body.templateSlug = flags.template;
          if (flags.ttl) body.ttlMinutes = flags.ttl;
          if (flags.cpu) body.cpu = flags.cpu;
          if (flags.memory) body.memory = flags.memory;
          if (flags.storage) body.storageGb = flags.storage;
          if (flags.repo) {
            const repos = Array.isArray(flags.repo)
              ? (flags.repo as string[])
              : [flags.repo as string];
            body.repos = repos.map((url) => ({
              url,
              branch: flags.branch as string | undefined,
            }));
          }
          if (flags["owner-id"]) body.ownerId = flags["owner-id"];
          if (flags["owner-type"]) body.ownerType = flags["owner-type"];
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes.post(body)
          );
          actionResult(flags, result, styleSuccess(`Sandbox "${args.name}" created.`));
        })
    )

    // --- list ---
    .command("list", (c) =>
      c
        .meta({ description: "List sandboxes" })
        .flags({
          all: {
            type: "boolean",
            alias: "a",
            description: "Include stopped/destroyed sandboxes",
          },
          status: {
            type: "string",
            alias: "s",
            description: "Filter by status",
          },
          "owner-id": {
            type: "string",
            description: "Filter by owner ID",
          },
          runtime: {
            type: "string",
            description: "Filter by runtime (container|vm)",
          },
          sort: {
            type: "string",
            description: "Sort by: name, status, created (default: name)",
          },
          limit: {
            type: "number",
            alias: "n",
            description: "Limit results (default: 50)",
          },
        })
        .run(async ({ flags }) => {
          const api = await getSandboxApi();
          const status = flags.all ? undefined : (flags.status as string | undefined);
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes.get({
              query: {
                status,
                ownerId: flags["owner-id"] as string | undefined,
                runtimeType: flags.runtime as string | undefined,
              },
            })
          );
          const colOpts: ColumnOpt[] = [
            {},                    // ID
            {},                    // Name
            {},                    // Runtime
            {},                    // CPU
            {},                    // Memory
            {},                    // Owner
            {},                    // Status
            {},                    // Created
          ];
          tableOrJson(
            flags,
            result,
            ["ID", "Name", "Runtime", "CPU", "Memory", "Owner", "Status", "Created"],
            (r) => [
              styleMuted(String(r.sandboxId ?? "")),
              styleBold(String(r.name ?? "")),
              String(r.runtimeType ?? ""),
              String(r.cpu ?? "-"),
              String(r.memory ?? "-"),
              String(r.ownerId ?? ""),
              colorStatus(String(r.status ?? "")),
              timeAgo(r.createdAt as string),
            ],
            colOpts,
            { emptyMessage: "No sandboxes found." },
          );
        })
    )

    // --- show ---
    .command("show", (c) =>
      c
        .meta({ description: "Show sandbox details" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).get()
          );
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.sandboxId ?? ""))],
            ["Name", (r) => styleBold(String(r.name ?? ""))],
            ["Runtime", (r) => String(r.runtimeType ?? "")],
            ["Status", (r) => colorStatus(String(r.status ?? ""))],
            ["CPU", (r) => String(r.cpu ?? "")],
            ["Memory", (r) => String(r.memory ?? "")],
            ["Storage", (r) => r.storageGb ? `${r.storageGb}GB` : ""],
            ["Template", (r) => String(r.templateSlug ?? "")],
            ["Owner", (r) => String(r.ownerId ?? "")],
            ["Owner Type", (r) => String(r.ownerType ?? "")],
            ["URL", (r) => String(r.url ?? "")],
            ["Created", (r) => timeAgo(r.createdAt as string)],
          ]);
        })
    )

    // --- start ---
    .command("start", (c) =>
      c
        .meta({ description: "Start a sandbox" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).start.post()
          );
          actionResult(flags, result, styleSuccess(`Sandbox ${args.id} started.`));
        })
    )

    // --- stop ---
    .command("stop", (c) =>
      c
        .meta({ description: "Stop a sandbox" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).stop.post()
          );
          actionResult(flags, result, styleSuccess(`Sandbox ${args.id} stopped.`));
        })
    )

    // --- delete ---
    .command("delete", (c) =>
      c
        .meta({ description: "Delete a sandbox" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).delete()
          );
          actionResult(flags, result, styleSuccess(`Sandbox ${args.id} deleted.`));
        })
    )

    // --- resize ---
    .command("resize", (c) =>
      c
        .meta({ description: "Resize a sandbox" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .flags({
          cpu: {
            type: "string",
            description: 'CPU spec (e.g. "2000m")',
          },
          memory: {
            type: "string",
            description: 'Memory spec (e.g. "4Gi")',
          },
          storage: {
            type: "number",
            description: "PVC size in GB",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const body: Record<string, unknown> = {};
          if (flags.cpu) body.cpu = flags.cpu;
          if (flags.memory) body.memory = flags.memory;
          if (flags.storage) body.storageGb = flags.storage;
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).resize.post(body)
          );
          actionResult(flags, result, styleSuccess(`Sandbox ${args.id} resized.`));
        })
    )

    // --- extend ---
    .command("extend", (c) =>
      c
        .meta({ description: "Extend sandbox TTL" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .flags({
          minutes: {
            type: "number",
            required: true,
            description: "Minutes to extend by",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1
              .sandboxes({ id: args.id })
              .extend.post({ minutes: flags.minutes as number })
          );
          actionResult(flags, result, styleSuccess(`Sandbox ${args.id} TTL extended by ${flags.minutes} minutes.`));
        })
    )

    // --- snapshot ---
    .command("snapshot", (c) =>
      c
        .meta({ description: "Manage sandbox snapshots" })
        .command("create", (sc) =>
          sc
            .meta({ description: "Create a snapshot of a sandbox" })
            .args([
              {
                name: "id",
                type: "string",
                required: true,
                description: "Sandbox ID",
              },
            ])
            .flags({
              name: {
                type: "string",
                required: true,
                description: "Snapshot name",
              },
              description: {
                type: "string",
                description: "Snapshot description",
              },
            })
            .run(async ({ args, flags }) => {
              const api = await getSandboxApi();
              const body: Record<string, unknown> = {
                name: flags.name as string,
              };
              if (flags.description) body.description = flags.description;
              const result = await apiCall(flags, () =>
                api.api.v1.sandboxes({ id: args.id }).snapshots.post(body)
              );
              actionResult(flags, result, styleSuccess(`Snapshot "${flags.name}" created for sandbox ${args.id}.`));
            })
        )
        .command("list", (sc) =>
          sc
            .meta({ description: "List snapshots for a sandbox" })
            .args([
              {
                name: "id",
                type: "string",
                required: true,
                description: "Sandbox ID",
              },
            ])
            .run(async ({ args, flags }) => {
              const api = await getSandboxApi();
              const result = await apiCall(flags, () =>
                api.api.v1.sandboxes({ id: args.id }).snapshots.get()
              );
              tableOrJson(
                flags,
                result,
                ["ID", "Name", "Status", "Created"],
                (r) => [
                  styleMuted(String(r.sandboxSnapshotId ?? "")),
                  styleBold(String(r.name ?? "")),
                  colorStatus(String(r.status ?? "")),
                  timeAgo(r.createdAt as string),
                ],
                undefined,
                { emptyMessage: "No snapshots found." },
              );
            })
        )
    )

    // --- restore ---
    .command("restore", (c) =>
      c
        .meta({ description: "Restore a sandbox from a snapshot" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .flags({
          snapshot: {
            type: "string",
            required: true,
            description: "Snapshot ID to restore from",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1["sandbox-snapshots"]({
              id: flags.snapshot as string,
            }).restore.post()
          );
          // args.id is the sandbox, but the restore endpoint is on the snapshot
          void args;
          actionResult(flags, result, styleSuccess(`Sandbox restored from snapshot ${flags.snapshot}.`));
        })
    )

    // --- clone ---
    .command("clone", (c) =>
      c
        .meta({ description: "Clone a sandbox from a snapshot" })
        .flags({
          snapshot: {
            type: "string",
            required: true,
            description: "Snapshot ID to clone from",
          },
          name: {
            type: "string",
            required: true,
            description: "Name for the new sandbox",
          },
        })
        .run(async ({ flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1["sandbox-snapshots"]({
              id: flags.snapshot as string,
            }).clone.post({ name: flags.name as string })
          );
          actionResult(flags, result, styleSuccess(`Sandbox "${flags.name}" cloned from snapshot ${flags.snapshot}.`));
        })
    )

    // --- share ---
    .command("share", (c) =>
      c
        .meta({ description: "Share a sandbox with a user" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .flags({
          user: {
            type: "string",
            required: true,
            description: "Principal ID to share with",
          },
          role: {
            type: "string",
            description: "Role (editor|viewer, default: viewer)",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).access.post({
              principalId: flags.user as string,
              role: (flags.role as string) ?? "viewer",
            })
          );
          actionResult(flags, result, styleSuccess(`Sandbox ${args.id} shared with ${flags.user}.`));
        })
    )

    // --- unshare ---
    .command("unshare", (c) =>
      c
        .meta({ description: "Revoke sandbox access for a user" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .flags({
          user: {
            type: "string",
            required: true,
            description: "Principal ID to revoke",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1
              .sandboxes({ id: args.id })
              .access({ principalId: flags.user as string })
              .delete()
          );
          actionResult(flags, result, styleSuccess(`Access revoked for ${flags.user} on sandbox ${args.id}.`));
        })
    )

    // --- access ---
    .command("access", (c) =>
      c
        .meta({ description: "List who has access to a sandbox" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getSandboxApi();
          const result = await apiCall(flags, () =>
            api.api.v1.sandboxes({ id: args.id }).access.get()
          );
          tableOrJson(flags, result, ["Principal", "Role", "Granted"], (r) => [
            styleBold(String(r.principalId ?? "")),
            String(r.role ?? ""),
            timeAgo(r.createdAt as string),
          ], undefined, { emptyMessage: "No access entries." });
        })
    );
}
