import { userInfo } from "node:os";
import { execFileSync } from "node:child_process";
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
import ora from "ora";

setExamples("sandbox", [
  "$ dx sandbox list                  List sandboxes",
  "$ dx sandbox create my-sandbox     Create a sandbox",
  "$ dx sandbox show my-sandbox       Show sandbox details",
  "$ dx sandbox start my-sandbox      Start a stopped sandbox",
  "$ dx sandbox stop my-sandbox       Stop a running sandbox",
  "$ dx sandbox logs my-sandbox       Stream sandbox logs",
  "$ dx sandbox open my-sandbox       Open web terminal in browser",
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
  const spinner = ora({ text: `Waiting for sandbox to be ${target}...`, spinner: 'dots' }).start();
  const interval = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const poll = await S(api)({ id: sandboxId }).get();
      const status = poll?.data?.data?.status ?? poll?.data?.status;
      spinner.text = `Sandbox status: ${status}...`;
      if (status === target) {
        spinner.succeed(`Sandbox is ${target}.`);
        return true;
      }
    } catch {
      // ignore transient errors
    }
  }
  spinner.warn(`Timed out waiting for sandbox to be ${target}.`);
  return false;
}

async function waitForSnapshotStatus(
  api: any,
  snapshotId: string,
  terminal: string[],
  maxWaitMs: number = 120_000,
): Promise<string> {
  const spinner = ora({ text: `Waiting for snapshot...`, spinner: 'dots' }).start();
  const interval = 3_000;
  const start = Date.now();
  let status = "creating";
  while (Date.now() - start < maxWaitMs && !terminal.includes(status)) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const poll = await S(api).snapshots({ id: snapshotId }).get();
      status = poll?.data?.data?.status ?? status;
      spinner.text = `Snapshot status: ${status}...`;
    } catch {
      // ignore transient errors
    }
  }
  if (terminal.includes(status)) {
    spinner.succeed(`Snapshot is ${status}.`);
  } else {
    spinner.warn(`Timed out waiting for snapshot (status: ${status}).`);
  }
  return status;
}

/** Run a command inside the sandbox workspace container via kubectl exec */
function kubectlExecInSandbox(
  podName: string,
  ns: string,
  cmd: string[],
  kubeContext?: string
): string {
  const args = [
    "exec", podName, "-n", ns, "-c", "workspace",
    ...(kubeContext ? ["--context", kubeContext] : []),
    "--", ...cmd,
  ];
  try {
    return execFileSync("kubectl", args, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

interface LogSource {
  name: string;
  type: "container" | "docker" | "process" | "system";
  description: string;
}

/** Discover all available log sources in a sandbox */
function discoverLogSources(
  podName: string,
  ns: string,
  kubeContext?: string
): LogSource[] {
  const sources: LogSource[] = [
    { name: "workspace", type: "container", description: "Workspace container (k8s)" },
    { name: "dind", type: "container", description: "Docker-in-Docker sidecar (k8s)" },
    { name: "clone-repos", type: "container", description: "Repo clone init container (k8s)" },
    { name: "build", type: "container", description: "Envbuilder build phase only" },
  ];

  // Discover Docker containers inside DinD
  const dockerPs = kubectlExecInSandbox(
    podName, ns,
    ["docker", "ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"],
    kubeContext
  );
  if (dockerPs) {
    for (const line of dockerPs.split("\n").filter(Boolean)) {
      const [name, status, ports] = line.split("\t");
      sources.push({
        name,
        type: "docker",
        description: `Docker: ${status}${ports ? ` (${ports})` : ""}`,
      });
    }
  }

  // Discover running processes
  const psOutput = kubectlExecInSandbox(
    podName, ns,
    ["ps", "axo", "pid,comm,args", "--no-headers"],
    kubeContext
  );
  if (psOutput) {
    const seen = new Set<string>();
    for (const line of psOutput.split("\n").filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[0];
      const comm = parts[1];
      const cmdline = parts.slice(2).join(" ");
      if (!comm || ["sleep", "sh", "bash", "ps", "tee", "cat", "grep", "tail"].includes(comm)) continue;
      if (seen.has(comm)) continue;
      seen.add(comm);
      sources.push({
        name: comm,
        type: "process",
        description: `PID ${pid}: ${cmdline.slice(0, 60)}`,
      });
    }
  }

  // Discover system log files
  const logFiles = kubectlExecInSandbox(
    podName, ns,
    ["sh", "-c", "ls /var/log/syslog /var/log/messages /var/log/auth.log 2>/dev/null || true"],
    kubeContext
  );
  if (logFiles) {
    for (const f of logFiles.split("\n").filter(Boolean)) {
      const basename = f.split("/").pop()!;
      sources.push({
        name: basename,
        type: "system",
        description: `System log: ${f}`,
      });
    }
  }

  // Check for journald
  const hasJournald = kubectlExecInSandbox(
    podName, ns,
    ["sh", "-c", "command -v journalctl >/dev/null 2>&1 && echo yes || echo no"],
    kubeContext
  );
  if (hasJournald === "yes") {
    sources.push({
      name: "journal",
      type: "system",
      description: "System journal (journalctl)",
    });
  }

  return sources;
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
            const spinner = ora({ text: "Provisioning sandbox...", spinner: "dots" }).start();
            const maxWait = 60_000;
            const interval = 2_000;
            const start = Date.now();
            let status = "provisioning";

            while (Date.now() - start < maxWait && status === "provisioning") {
              await new Promise((r) => setTimeout(r, interval));
              try {
                const poll = await S(api)({ id: sandboxId }).get();
                status = poll?.data?.data?.status ?? status;
                spinner.text = `Sandbox status: ${status}...`;
              } catch {
                // ignore transient errors
              }
            }

            if (status === "active") {
              spinner.succeed(`Sandbox "${args.name}" is active.`);
              const poll = await S(api)({ id: sandboxId }).get();
              const sbxData = poll?.data?.data;
              if (sbxData?.webTerminalUrl) {
                console.log(styleMuted(`  Terminal: ${sbxData.webTerminalUrl}`));
              }
              if (sbxData?.webIdeUrl) {
                console.log(styleMuted(`  IDE:      ${sbxData.webIdeUrl}`));
              }
              if (sbxData?.sshHost && sbxData?.sshPort) {
                console.log(styleMuted(`  SSH:      ssh -p ${sbxData.sshPort} ${sbxData.sshHost}`));
              }
              // Add /etc/hosts entry for local gateway routing
              const cfg = await readConfig();
              const factoryUrl = resolveFactoryUrl(cfg);
              if (factoryUrl.includes("localhost") || factoryUrl.includes("127.0.0.1")) {
                const slug = (sbxData?.slug as string) ?? args.name;
                await addHostEntry(slug, "sandbox");
              }
            } else {
              spinner.warn(`Sandbox status: ${status} (may still be provisioning)`);
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
            {},                    // Health
            {},                    // Created
          ];
          tableOrJson(
            flags,
            result,
            ["ID", "Name", "Runtime", "CPU", "Memory", "Owner", "Status", "Health", "Created"],
            (r) => [
              styleMuted(String(r.sandboxId ?? "")),
              styleBold(String(r.name ?? "")),
              String(r.runtimeType ?? ""),
              String(r.cpu ?? "-"),
              String(r.memory ?? "-"),
              String(r.ownerId ?? ""),
              colorStatus(String(r.status ?? "")),
              colorStatus(String(r.healthStatus ?? "unknown")),
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
            ["Health", (r) => {
              const h = String(r.healthStatus ?? "unknown");
              const checkedAt = r.healthCheckedAt ? ` (checked ${timeAgo(r.healthCheckedAt as string)})` : "";
              return colorStatus(h) + styleMuted(checkedAt);
            }],
            ["CPU", (r) => String(r.cpu ?? "")],
            ["Memory", (r) => String(r.memory ?? "")],
            ["Storage", (r) => r.storageGb ? `${r.storageGb}GB` : ""],
            ["Template", (r) => String(r.templateSlug ?? "")],
            ["Owner", (r) => String(r.ownerId ?? "")],
            ["Owner Type", (r) => String(r.ownerType ?? "")],
            ["Terminal", (r) => String(r.webTerminalUrl ?? "")],
            ["IDE", (r) => String(r.webIdeUrl ?? "")],
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
    )

    // --- exec ---
    .command("exec", (c) =>
      c
        .meta({ description: "Execute a command in a sandbox" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID or slug",
          },
        ])
        .flags({
          container: {
            type: "string",
            alias: "c",
            description: 'Container name (default: "workspace")',
          },
          context: {
            type: "string",
            description: "kubectl context override",
          },
          command: {
            type: "string",
            description: 'Command to run (default: "/bin/bash")',
          },
        })
        .run(async ({ args, flags, rawArgs }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).get()
          );
          const sbx = result?.data;
          if (!sbx) {
            console.error("Sandbox not found.");
            process.exit(1);
          }

          const slug = sbx.slug as string;
          const podName = (sbx.podName as string) || `sandbox-${slug}`;
          const ns = `sandbox-${slug}`;
          const container = (flags.container as string) || "workspace";

          // Determine kubectl context: flag > env > auto-detect from cluster
          const kubeContext = (flags.context as string)
            || process.env.KUBE_CONTEXT
            || undefined;

          // Parse -- separated command args
          const dashDashIdx = process.argv.indexOf("--");
          let execCmd: string[];
          if (dashDashIdx >= 0) {
            execCmd = process.argv.slice(dashDashIdx + 1);
          } else if (flags.command) {
            execCmd = (flags.command as string).split(/\s+/);
          } else {
            execCmd = ["/bin/bash"];
          }

          const isTTY = process.stdin.isTTY && process.stdout.isTTY;
          const kubectlArgs = [
            "exec",
            ...(isTTY ? ["-it"] : ["-i"]),
            podName,
            "-n", ns,
            "-c", container,
            ...(kubeContext ? ["--context", kubeContext] : []),
            "--",
            ...execCmd,
          ];

          try {
            execFileSync("kubectl", kubectlArgs, {
              stdio: "inherit",
            });
          } catch (err: any) {
            // kubectl exec returns the exit code of the remote command
            process.exit(err.status ?? 1);
          }
        })
    )
    .command("logs", (c) =>
      c
        .meta({ description: "Stream logs from sandbox containers, services, or processes" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID or slug",
          },
          {
            name: "source",
            type: "string",
            required: false,
            description: 'Log source: container name, docker service, process name, or "build"',
          },
        ])
        .flags({
          follow: {
            type: "boolean",
            alias: "f",
            description: "Stream logs in real-time (default: true)",
          },
          tail: {
            type: "number",
            alias: "n",
            description: "Lines from end (default: 100)",
          },
          list: {
            type: "boolean",
            description: "List all available log sources",
          },
          service: {
            type: "string",
            description: "Tail logs for a process by name inside the workspace",
          },
          file: {
            type: "string",
            description: "Tail a specific log file path inside the workspace",
          },
          context: {
            type: "string",
            description: "kubectl context override",
          },
          timestamps: {
            type: "boolean",
            description: "Show timestamps on each line",
          },
          previous: {
            type: "boolean",
            description: "Show logs from previous container instance",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).get()
          );
          const sbx = result?.data;
          if (!sbx) {
            console.error("Sandbox not found.");
            process.exit(1);
          }

          const slug = sbx.slug as string;
          const podName = (sbx.podName as string) || `sandbox-${slug}`;
          const ns = `sandbox-${slug}`;
          const kubeContext =
            (flags.context as string) || process.env.KUBE_CONTEXT || undefined;
          const follow = flags.follow !== false;
          const tail = (flags.tail as number) || 100;

          // --list: discover and display all log sources
          if (flags.list) {
            const sources = discoverLogSources(podName, ns, kubeContext);
            const grouped = {
              container: sources.filter((s) => s.type === "container"),
              docker: sources.filter((s) => s.type === "docker"),
              process: sources.filter((s) => s.type === "process"),
              system: sources.filter((s) => s.type === "system"),
            };

            if (grouped.container.length) {
              console.log(styleBold("CONTAINERS (k8s):"));
              for (const s of grouped.container) {
                console.log(`  ${styleBold(s.name.padEnd(20))} ${styleMuted(s.description)}`);
              }
            }
            if (grouped.docker.length) {
              console.log(styleBold("\nDOCKER SERVICES (inside sandbox):"));
              for (const s of grouped.docker) {
                console.log(`  ${styleBold(s.name.padEnd(20))} ${styleMuted(s.description)}`);
              }
            }
            if (grouped.process.length) {
              console.log(styleBold("\nPROCESSES (workspace):"));
              for (const s of grouped.process) {
                console.log(`  ${styleBold(s.name.padEnd(20))} ${styleMuted(s.description)}`);
              }
            }
            if (grouped.system.length) {
              console.log(styleBold("\nSYSTEM LOGS:"));
              for (const s of grouped.system) {
                console.log(`  ${styleBold(s.name.padEnd(20))} ${styleMuted(s.description)}`);
              }
            }
            return;
          }

          // --file: tail arbitrary file inside workspace
          if (flags.file) {
            const tailCmd = follow
              ? ["tail", `-${tail}f`, flags.file as string]
              : ["tail", `-${tail}`, flags.file as string];
            try {
              execFileSync("kubectl", [
                "exec", podName, "-n", ns, "-c", "workspace",
                ...(kubeContext ? ["--context", kubeContext] : []),
                "--", ...tailCmd,
              ], { stdio: "inherit" });
            } catch (err: any) {
              process.exit(err.status ?? 1);
            }
            return;
          }

          // --service: find process by name and tail its stdout
          if (flags.service) {
            const svcName = flags.service as string;
            const pidOutput = kubectlExecInSandbox(
              podName, ns,
              ["sh", "-c", `pgrep -f '${svcName}' | head -1`],
              kubeContext
            );
            if (!pidOutput) {
              console.error(`No process found matching "${svcName}".`);
              console.error("Use --list to see available log sources.");
              process.exit(1);
            }
            const pid = pidOutput.trim();
            const tailCmd = follow
              ? ["tail", `-${tail}f`, `/proc/${pid}/fd/1`]
              : ["tail", `-${tail}`, `/proc/${pid}/fd/1`];
            try {
              execFileSync("kubectl", [
                "exec", podName, "-n", ns, "-c", "workspace",
                ...(kubeContext ? ["--context", kubeContext] : []),
                "--", ...tailCmd,
              ], { stdio: "inherit" });
            } catch (err: any) {
              console.error(`Could not read stdout for PID ${pid}. Trying stderr...`);
              try {
                execFileSync("kubectl", [
                  "exec", podName, "-n", ns, "-c", "workspace",
                  ...(kubeContext ? ["--context", kubeContext] : []),
                  "--", "tail", `-${tail}${follow ? "f" : ""}`, `/proc/${pid}/fd/2`,
                ], { stdio: "inherit" });
              } catch (err2: any) {
                console.error(`Could not access logs for process "${svcName}" (PID ${pid}).`);
                process.exit(1);
              }
            }
            return;
          }

          // Resolve named source
          const source = (args as any).source as string | undefined || "workspace";
          const k8sContainers = ["workspace", "dind", "clone-repos"];

          // Special: "build" source = workspace container with build filter
          if (source === "build") {
            const { execFile } = await import("node:child_process");
            const kubectlArgs = [
              "logs", podName, "-n", ns, "-c", "workspace",
              "--follow", `--tail=${tail}`,
              ...(flags.timestamps ? ["--timestamps"] : []),
              ...(kubeContext ? ["--context", kubeContext] : []),
            ];
            const proc = execFile("kubectl", kubectlArgs, { maxBuffer: 50 * 1024 * 1024 });
            proc.stdout?.on("data", (chunk: Buffer) => {
              const lines = chunk.toString().split("\n");
              for (const line of lines) {
                if (line.includes("Running init command")) {
                  process.stdout.write(line + "\n");
                  proc.kill();
                  return;
                }
                process.stdout.write(line + "\n");
              }
            });
            proc.stderr?.pipe(process.stderr);
            proc.on("exit", (code) => process.exit(code ?? 0));
            return;
          }

          // k8s container logs
          if (k8sContainers.includes(source)) {
            const kubectlArgs = [
              "logs", podName, "-n", ns, "-c", source,
              ...(follow ? ["--follow"] : []),
              `--tail=${tail}`,
              ...(flags.timestamps ? ["--timestamps"] : []),
              ...(flags.previous ? ["--previous"] : []),
              ...(kubeContext ? ["--context", kubeContext] : []),
            ];
            try {
              execFileSync("kubectl", kubectlArgs, { stdio: "inherit" });
            } catch (err: any) {
              process.exit(err.status ?? 1);
            }
            return;
          }

          // System log sources
          const systemLogMap: Record<string, string[]> = {
            syslog: ["cat", "/var/log/syslog"],
            messages: ["cat", "/var/log/messages"],
            "auth.log": ["cat", "/var/log/auth.log"],
            journal: ["journalctl", "--no-pager", `-n${tail}`, ...(follow ? ["-f"] : [])],
          };
          if (systemLogMap[source]) {
            try {
              execFileSync("kubectl", [
                "exec", podName, "-n", ns, "-c", "workspace",
                ...(kubeContext ? ["--context", kubeContext] : []),
                "--", ...systemLogMap[source],
              ], { stdio: "inherit" });
            } catch (err: any) {
              process.exit(err.status ?? 1);
            }
            return;
          }

          // Try as Docker container name inside DinD
          const dockerArgs = follow
            ? ["docker", "logs", "--follow", "--tail", String(tail), source]
            : ["docker", "logs", "--tail", String(tail), source];
          try {
            execFileSync("kubectl", [
              "exec", podName, "-n", ns, "-c", "workspace",
              ...(kubeContext ? ["--context", kubeContext] : []),
              "--", ...dockerArgs,
            ], { stdio: "inherit" });
          } catch (err: any) {
            console.error(`Log source "${source}" not found as a k8s container or Docker service.`);
            console.error("Use --list to see available log sources.");
            process.exit(1);
          }
        })
    )
    .command("open", (c) =>
      c
        .meta({ description: "Open sandbox in browser (IDE by default)" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Sandbox ID or slug",
          },
        ])
        .flags({
          terminal: {
            type: "boolean",
            alias: "t",
            description: "Open web terminal instead of IDE",
          },
          port: {
            type: "number",
            alias: "p",
            description: "Open a specific port (e.g. 3000 for dev server)",
          },
          url: {
            type: "boolean",
            description: "Print the URL instead of opening browser",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            S(api)({ id: args.id }).get()
          );
          const sbx = result?.data;
          if (!sbx) {
            console.error("Sandbox not found.");
            process.exit(1);
          }

          const slug = sbx.slug as string;
          const config = await readConfig();
          const factoryUrl = resolveFactoryUrl(config);
          const isLocal =
            factoryUrl.includes("localhost") || factoryUrl.includes("127.0.0.1");

          let url: string;
          if (flags.port) {
            if (isLocal) {
              console.error(
                `Port forwarding: kubectl port-forward -n sandbox-${slug} sandbox-${slug} ${flags.port}:${flags.port}`
              );
              console.error(`Then open: http://localhost:${flags.port}`);
              process.exit(0);
            }
            url = `https://${slug}-${flags.port}.sandbox.dx.dev`;
          } else if (flags.terminal) {
            url = (sbx.webTerminalUrl as string) || `https://${slug}.sandbox.dx.dev`;
            if (isLocal && sbx.sshPort) {
              url = `http://localhost:${(sbx.sshPort as number) + 1}`;
            }
          } else {
            // Default to IDE, fall back to terminal
            url = (sbx.webIdeUrl as string) || (sbx.webTerminalUrl as string) || `https://${slug}--ide.sandbox.dx.dev`;
          }

          if (flags.url) {
            console.log(url);
          } else {
            const { platform } = await import("node:os");
            const openCmd =
              platform() === "darwin"
                ? "open"
                : platform() === "win32"
                  ? "start"
                  : "xdg-open";
            try {
              execFileSync(openCmd, [url], { stdio: "ignore" });
              console.error(`Opened ${url}`);
            } catch {
              console.log(url);
            }
          }
        })
    );
}
