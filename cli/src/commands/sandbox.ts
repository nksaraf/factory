import { userInfo } from "node:os";
import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { readConfig, resolveFactoryUrl } from "../config.js";
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
import { setExamples } from "../plugins/examples-plugin.js";
import { addHostEntry, removeHostEntry } from "../lib/hosts-manager.js";

setExamples("sandbox", [
  "$ dx sandbox list                  List sandboxes",
  "$ dx sandbox create my-sandbox     Create a sandbox",
  "$ dx sandbox show my-sandbox       Show sandbox details",
  "$ dx sandbox start my-sandbox      Start a stopped sandbox",
  "$ dx sandbox stop my-sandbox       Stop a running sandbox",
]);

// Returns the full factory client. Callers access Eden paths inline via S().
// NOTE: Do NOT pre-resolve Eden proxy paths and return/await them —
// Eden proxies are thenables, so `await` triggers an HTTP call.
async function getApi() {
  return getFactoryClient();
}
// Shorthand to reach the sandboxes sub-path on the Eden proxy.
const S = (api: any) => api.api.v1.factory.infra.sandboxes;

async function waitForStatus(api: any, sandboxId: string, target: string, maxWaitMs: number): Promise<boolean> {
  const interval = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const poll = await S(api)({ id: sandboxId }).get();
      if (poll?.data?.data?.status === target) return true;
    } catch {
      // ignore transient errors
    }
    process.stdout.write(".");
  }
  return false;
}

async function waitForSnapshotStatus(
  api: any,
  snapshotId: string,
  terminal: string[],
  maxWaitMs: number = 120_000,
): Promise<string> {
  const interval = 3_000;
  const start = Date.now();
  let status = "creating";
  while (Date.now() - start < maxWaitMs && !terminal.includes(status)) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const poll = await S(api).snapshots({ id: snapshotId }).get();
      status = poll?.data?.data?.status ?? status;
    } catch {
      // ignore transient errors
    }
    process.stdout.write(".");
  }
  return status;
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
          cluster: {
            type: "string",
            description: "Cluster ID to deploy to (auto-selects if omitted)",
          },
          wait: {
            type: "boolean",
            alias: "w",
            description: "Wait for sandbox to become active (default: true)",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getApi();
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
          body.ownerId = (flags["owner-id"] as string) || `local:${userInfo().username}`;
          body.ownerType = (flags["owner-type"] as string) || "user";
          if (flags.cluster) body.clusterId = flags.cluster;
          const result = await apiCall(flags, () =>
            S(api).post(body)
          );
          if (!result?.data?.sandboxId) {
            actionResult(flags, result, styleSuccess(`Sandbox "${args.name}" created.`));
            return;
          }

          const sandboxId = result.data.sandboxId as string;
          const shouldWait = flags.wait !== false;

          if (shouldWait) {
            process.stdout.write(styleMuted("Provisioning sandbox..."));
            const maxWait = 60_000;
            const interval = 2_000;
            const start = Date.now();
            let status = "provisioning";

            while (Date.now() - start < maxWait && status === "provisioning") {
              await new Promise((r) => setTimeout(r, interval));
              try {
                const poll = await S(api)({ id: sandboxId }).get();
                status = poll?.data?.data?.status ?? status;
              } catch {
                // ignore transient errors
              }
              process.stdout.write(".");
            }
            console.log();

            if (status === "active") {
              console.log(styleSuccess(`Sandbox "${args.name}" is active.`));
              const poll = await S(api)({ id: sandboxId }).get();
              const sbxData = poll?.data?.data;
              if (sbxData?.webTerminalUrl) {
                console.log(styleMuted(`  URL: ${sbxData.webTerminalUrl}`));
              }
              if (sbxData?.sshHost && sbxData?.sshPort) {
                console.log(styleMuted(`  SSH: ssh -p ${sbxData.sshPort} ${sbxData.sshHost}`));
              }
              // Add /etc/hosts entry for local gateway routing
              const cfg = await readConfig();
              const factoryUrl = resolveFactoryUrl(cfg);
              if (factoryUrl.includes("localhost") || factoryUrl.includes("127.0.0.1")) {
                const slug = (sbxData?.slug as string) ?? args.name;
                await addHostEntry(slug, "sandbox");
              }
            } else {
              console.log(styleMuted(`Sandbox status: ${status} (may still be provisioning)`));
            }
          } else {
            actionResult(flags, result, styleSuccess(`Sandbox "${args.name}" created (provisioning in background).`));
          }
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
          const api = await getApi();
          const status = flags.all ? undefined : (flags.status as string | undefined);
          const result = await apiCall(flags, () =>
            S(api).get({
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).get()
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).start.post()
          );
          process.stdout.write(styleMuted("Starting sandbox..."));
          const ok = await waitForStatus(api, args.id, "active", 60_000);
          console.log();
          if (ok) {
            console.log(styleSuccess(`Sandbox ${args.id} started.`));
          } else {
            console.log(styleMuted(`Sandbox ${args.id} start initiated (may still be starting).`));
          }
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).stop.post()
          );
          process.stdout.write(styleMuted("Stopping sandbox..."));
          const ok = await waitForStatus(api, args.id, "suspended", 30_000);
          console.log();
          if (ok) {
            console.log(styleSuccess(`Sandbox ${args.id} stopped.`));
          } else {
            console.log(styleMuted(`Sandbox ${args.id} stop initiated (may still be in progress).`));
          }
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).delete()
          );
          process.stdout.write(styleMuted("Destroying sandbox..."));
          const ok = await waitForStatus(api, args.id, "destroyed", 60_000);
          console.log();
          if (ok) {
            console.log(styleSuccess(`Sandbox ${args.id} destroyed.`));
            // Remove /etc/hosts entry for local gateway routing
            const cfg = await readConfig();
            const factoryUrl = resolveFactoryUrl(cfg);
            if (factoryUrl.includes("localhost") || factoryUrl.includes("127.0.0.1")) {
              await removeHostEntry(args.id, "sandbox");
            }
          } else {
            console.log(styleMuted(`Sandbox ${args.id} delete initiated (may still be destroying).`));
          }
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
          const api = await getApi();
          const body: Record<string, unknown> = {};
          if (flags.cpu) body.cpu = flags.cpu;
          if (flags.memory) body.memory = flags.memory;
          if (flags.storage) body.storageGb = flags.storage;
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).resize.post(body)
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id })
              .extend.post({ additionalMinutes: flags.minutes as number })
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
              wait: {
                type: "boolean",
                alias: "w",
                description: "Wait for snapshot to be ready (default: true)",
              },
            })
            .run(async ({ args, flags }) => {
              const api = await getApi();
              const body: Record<string, unknown> = {
                name: flags.name as string,
              };
              if (flags.description) body.description = flags.description;
              const result = await apiCall(flags, () =>
                S(api)({ id: args.id }).snapshots.post(body)
              );
              const snapshotId = result?.data?.sandboxSnapshotId as string | undefined;
              if (!snapshotId || flags.wait === false) {
                actionResult(flags, result, styleSuccess(`Snapshot "${flags.name}" created for sandbox ${args.id}.`));
                return;
              }
              process.stdout.write(styleMuted("Creating snapshot..."));
              const finalStatus = await waitForSnapshotStatus(api, snapshotId, ["ready", "failed"]);
              console.log();
              if (finalStatus === "ready") {
                console.log(styleSuccess(`Snapshot "${flags.name}" is ready (${snapshotId}).`));
              } else {
                console.log(`Snapshot "${flags.name}" ${finalStatus} (${snapshotId}).`);
              }
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
              const api = await getApi();
              const result = await apiCall(flags, () =>
                S(api)({ id: args.id }).snapshots.get()
              );
              tableOrJson(
                flags,
                result,
                ["ID", "Name", "Status", "Size", "Created"],
                (r) => [
                  styleMuted(String(r.sandboxSnapshotId ?? "")),
                  styleBold(String(r.name ?? "")),
                  colorStatus(String(r.status ?? "")),
                  r.sizeBytes ? `${Math.round(Number(r.sizeBytes) / 1024 / 1024)}MB` : "-",
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
          wait: {
            type: "boolean",
            alias: "w",
            description: "Wait for sandbox to become active after restore (default: true)",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api).snapshots({
              id: flags.snapshot as string,
            }).restore.post()
          );
          // args.id is the sandbox, but the restore endpoint is on the snapshot
          if (flags.wait !== false) {
            process.stdout.write(styleMuted("Restoring sandbox..."));
            const ready = await waitForStatus(api, args.id, "active", 120_000);
            console.log();
            if (ready) {
              console.log(styleSuccess(`Sandbox ${args.id} restored from snapshot ${flags.snapshot}.`));
            } else {
              console.log(`Sandbox ${args.id} restore may still be in progress. Check with: dx sandbox show ${args.id}`);
            }
          } else {
            actionResult(flags, result, styleSuccess(`Sandbox restore triggered from snapshot ${flags.snapshot}.`));
          }
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api).snapshots({
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).access.post({
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id })
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
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).access.get()
          );
          tableOrJson(flags, result, ["Principal", "Role", "Granted"], (r) => [
            styleBold(String(r.principalId ?? "")),
            String(r.role ?? ""),
            timeAgo(r.createdAt as string),
          ], undefined, { emptyMessage: "No access entries." });
        })
    );
}
