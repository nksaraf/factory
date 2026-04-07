import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import {
  apiCall,
  tableOrJson,
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  timeAgo,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";
import {
  createK3dCluster,
  deleteK3dCluster,
  listK3dClusters,
  getK3dKubeconfig,
} from "../handlers/cluster/k3d.js";
import { seedLocalInfra } from "../handlers/cluster/register.js";

setExamples("cluster", [
  "$ dx cluster list                   List clusters",
  "$ dx cluster create --local         Create a local k3d cluster",
  "$ dx cluster create my-cluster --local  Create a named local cluster",
  "$ dx cluster delete my-cluster      Delete a cluster",
]);

async function getApi() {
  return getFactoryClient();
}
const C = (api: Awaited<ReturnType<typeof getApi>>) => api.api.v1.factory.infra.runtimes;

export function clusterCommand(app: DxBase) {
  return app
    .sub("cluster")
    .meta({ description: "Manage clusters" })

    // --- create ---
    .command("create", (c) =>
      c
        .meta({ description: "Create a cluster" })
        .args([
          {
            name: "name",
            type: "string",
            description: "Cluster name (default: dx-local)",
          },
        ])
        .flags({
          local: {
            type: "boolean",
            description: "Create a local k3d cluster",
          },
        })
        .run(async ({ args, flags }) => {
          const name = (args.name as string) || "dx-local";
          const isLocal = flags.local as boolean;

          if (!isLocal) {
            console.log(
              "Remote cluster creation is not yet supported.\n" +
              "Use --local to create a local k3d cluster."
            );
            process.exitCode = 1;
            return;
          }

          // Create k3d cluster
          const { kubeconfigPath } = await createK3dCluster({ name });

          // Register in local factory DB
          await seedLocalInfra(name, kubeconfigPath);

          console.log(`\nCluster '${name}' is ready.`);
          console.log(`  Kubeconfig: ${kubeconfigPath}`);
        })
    )

    // --- delete ---
    .command("delete", (c) =>
      c
        .meta({ description: "Delete a cluster" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Cluster name",
          },
        ])
        .flags({
          local: {
            type: "boolean",
            description: "Delete the local k3d cluster",
          },
        })
        .run(async ({ args, flags }) => {
          const name = args.name as string;
          const isLocal = flags.local as boolean;

          if (isLocal) {
            await deleteK3dCluster(name);
          } else {
            // Delete via API
            const api = await getApi();
            const res = await C(api)({ slugOrId: name }).delete.post();
            actionResult(res, "delete", "cluster");
          }
        })
    )

    // --- status ---
    .command("status", (c) =>
      c
        .meta({ description: "Show cluster status" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Cluster name",
          },
        ])
        .flags({
          local: {
            type: "boolean",
            description: "Show status for a local k3d cluster",
          },
          json: {
            type: "boolean",
            description: "Output as JSON",
          },
        })
        .run(async ({ args, flags }) => {
          const name = args.name as string;
          const isLocal = flags.local as boolean;
          const json = flags.json as boolean;

          if (isLocal) {
            const clusters = await listK3dClusters();
            const cluster = clusters.find((c) => c.name === name);
            if (!cluster) {
              console.log(`Cluster '${name}' not found.`);
              process.exitCode = 1;
              return;
            }

            const servers = cluster.nodes?.filter((n) => n.role === "server") ?? [];
            const agents = cluster.nodes?.filter((n) => n.role === "agent") ?? [];
            const kubeconfigPath = await getK3dKubeconfig(name);

            if (json) {
              console.log(JSON.stringify({
                name: cluster.name,
                servers: servers.length,
                agents: agents.length,
                nodes: cluster.nodes,
                kubeconfigPath,
              }, null, 2));
            } else {
              console.log(`${styleBold(cluster.name)}`);
              console.log(`  Servers:    ${servers.length}`);
              console.log(`  Agents:     ${agents.length}`);
              console.log(`  Kubeconfig: ${kubeconfigPath}`);
              for (const node of cluster.nodes ?? []) {
                const state = node.state?.running ? "running" : (node.state?.status ?? "unknown");
                console.log(`  ${styleMuted("node")} ${node.name}  role=${node.role}  state=${state}`);
              }
            }
            return;
          }

          // Remote: fetch from API
          const api = await getApi();
          const res = await apiCall(flags, () =>
            C(api)({ slugOrId: name }).get()
          );
          if (json) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            const d = res?.data;
            if (d) {
              const spec = (d.spec && typeof d.spec === "object" ? d.spec : {}) as Record<string, unknown>;
              console.log(`${styleBold(String(d.name ?? name))}`);
              console.log(`  Slug:     ${d.slug ?? ""}`);
              console.log(`  Status:   ${colorStatus(String(d.status ?? ""))}`);
              console.log(`  Substrate: ${d.parentSubstrateId ?? ""}`);
              if (spec.endpoint) console.log(`  Endpoint: ${spec.endpoint}`);
              if (d.createdAt) console.log(`  Created:  ${timeAgo(String(d.createdAt))}`);
            }
          }
        })
    )

    // --- list ---
    .command("list", (c) =>
      c
        .meta({ description: "List clusters" })
        .flags({
          local: {
            type: "boolean",
            description: "List local k3d clusters only",
          },
          json: {
            type: "boolean",
            description: "Output as JSON",
          },
        })
        .run(async ({ flags }) => {
          const isLocal = flags.local as boolean;
          const json = flags.json as boolean;

          if (isLocal) {
            const clusters = await listK3dClusters();
            if (json) {
              console.log(JSON.stringify(clusters, null, 2));
            } else {
              for (const c of clusters) {
                const agents = c.nodes?.filter((n) => n.role === "agent")?.length ?? 0;
                const servers = c.nodes?.filter((n) => n.role === "server")?.length ?? 0;
                console.log(`  ${styleBold(c.name)}  servers=${servers} agents=${agents}`);
              }
              if (clusters.length === 0) {
                console.log("No local k3d clusters found.");
              }
            }
            return;
          }

          // List from factory API
          const api = await getApi();
          const res = await apiCall(flags, () => C(api).get());
          tableOrJson(
            flags,
            res,
            ["Name", "Slug", "Status", "Created"],
            (r) => [
              styleBold(String(r.name ?? "")),
              String(r.slug ?? ""),
              colorStatus(String(r.status ?? "")),
              timeAgo(r.createdAt as string),
            ]
          );
        })
    );
}
