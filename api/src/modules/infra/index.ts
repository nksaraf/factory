import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { InfraModel } from "./model"
import * as providerSvc from "../../services/infra/provider.service"
import * as regionSvc from "../../services/infra/region.service"
import * as clusterSvc from "../../services/infra/cluster.service"
import * as vmSvc from "../../services/infra/vm.service"
import * as hostSvc from "../../services/infra/host.service"
import * as kubeNodeSvc from "../../services/infra/kube-node.service"
import * as ipamSvc from "../../services/infra/ipam.service"
import * as assetsSvc from "../../services/infra/assets.service"
import * as vmcSvc from "../../services/infra/vm-cluster.service"

export function infraController(db: Database) {
  return new Elysia()

    // --- Providers ---
    .get("/providers", async ({ query }) => ({
      success: true,
      data: await providerSvc.listProviders(db, query),
    }), {
      query: InfraModel.listProvidersQuery,
      detail: { tags: ["Infra"], summary: "List providers" },
    })
    .get("/providers/:id", async ({ params, set }) => {
      const row = await providerSvc.getProvider(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get provider" },
    })
    .post("/providers", async ({ body }) => ({
      success: true,
      data: await providerSvc.createProvider(db, body),
    }), {
      body: InfraModel.createProviderBody,
      detail: { tags: ["Infra"], summary: "Create provider" },
    })
    .post("/providers/:id/sync", async ({ params }) => ({
      success: true,
      data: await providerSvc.syncProvider(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Sync provider inventory" },
    })

    // --- VM Clusters ---
    .get("/vm-clusters", async ({ query }) => ({
      success: true,
      data: await vmcSvc.listVmClusters(db, query),
    }), {
      query: InfraModel.listVmClustersQuery,
      detail: { tags: ["Infra"], summary: "List VM clusters" },
    })
    .get("/vm-clusters/:id", async ({ params, set }) => {
      const row = await vmcSvc.getVmCluster(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get VM cluster" },
    })
    .post("/vm-clusters", async ({ body }) => ({
      success: true,
      data: await vmcSvc.createVmCluster(db, body),
    }), {
      body: InfraModel.createVmClusterBody,
      detail: { tags: ["Infra"], summary: "Register VM cluster" },
    })
    .post("/vm-clusters/:id/update", async ({ params, body, set }) => {
      const row = await vmcSvc.updateVmCluster(db, params.id, body)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      body: InfraModel.updateVmClusterBody,
      detail: { tags: ["Infra"], summary: "Update VM cluster" },
    })
    .post("/vm-clusters/:id/delete", async ({ params, set }) => {
      const row = await vmcSvc.deleteVmCluster(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Delete VM cluster" },
    })

    // --- Regions ---
    .get("/regions", async ({ query }) => ({
      success: true,
      data: await regionSvc.listRegions(db, query),
    }), {
      query: InfraModel.listRegionsQuery,
      detail: { tags: ["Infra"], summary: "List regions" },
    })
    .get("/regions/:id", async ({ params, set }) => {
      const row = await regionSvc.getRegion(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get region" },
    })
    .post("/regions", async ({ body }) => ({
      success: true,
      data: await regionSvc.createRegion(db, body),
    }), {
      body: InfraModel.createRegionBody,
      detail: { tags: ["Infra"], summary: "Create region" },
    })
    .post("/regions/:id/delete", async ({ params, set }) => {
      const row = await regionSvc.deleteRegion(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Delete region" },
    })

    // --- Clusters ---
    .get("/clusters", async ({ query }) => ({
      success: true,
      data: await clusterSvc.listClusters(db, query),
    }), {
      query: InfraModel.listClustersQuery,
      detail: { tags: ["Infra"], summary: "List clusters" },
    })
    .get("/clusters/:id", async ({ params, set }) => {
      const row = await clusterSvc.getCluster(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get cluster" },
    })
    .post("/clusters", async ({ body }) => ({
      success: true,
      data: await clusterSvc.createCluster(db, body),
    }), {
      body: InfraModel.createClusterBody,
      detail: { tags: ["Infra"], summary: "Create cluster" },
    })
    .post("/clusters/:id/upgrade", async ({ params }) => ({
      success: true,
      data: { clusterId: params.id, message: "upgrade not yet implemented" },
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Upgrade cluster" },
    })
    .post("/clusters/:id/delete", async ({ params, set }) => {
      const row = await clusterSvc.destroyCluster(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Destroy cluster" },
    })

    // --- VMs ---
    .get("/vms", async ({ query }) => ({
      success: true,
      data: await vmSvc.listVms(db, query),
    }), {
      query: InfraModel.listVmsQuery,
      detail: { tags: ["Infra"], summary: "List VMs" },
    })
    .get("/vms/:id", async ({ params, set }) => {
      const row = await vmSvc.getVm(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get VM" },
    })
    .post("/vms", async ({ body }) => ({
      success: true,
      data: await vmSvc.createVm(db, body),
    }), {
      body: InfraModel.createVmBody,
      detail: { tags: ["Infra"], summary: "Create VM" },
    })
    .post("/vms/:id/start", async ({ params }) => ({
      success: true,
      data: await vmSvc.startVm(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Start VM" },
    })
    .post("/vms/:id/stop", async ({ params }) => ({
      success: true,
      data: await vmSvc.stopVm(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Stop VM" },
    })
    .post("/vms/:id/restart", async ({ params }) => ({
      success: true,
      data: await vmSvc.restartVm(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Restart VM" },
    })
    .post("/vms/:id/resize", async ({ params, body }) => ({
      success: true,
      data: await vmSvc.resizeVm(db, params.id, body),
    }), {
      params: InfraModel.idParams,
      body: InfraModel.resizeVmBody,
      detail: { tags: ["Infra"], summary: "Resize VM" },
    })
    .post("/vms/:id/migrate", async ({ params, body }) => ({
      success: true,
      data: await vmSvc.migrateVm(db, params.id, body.targetHostId),
    }), {
      params: InfraModel.idParams,
      body: InfraModel.migrateVmBody,
      detail: { tags: ["Infra"], summary: "Migrate VM" },
    })
    .post("/vms/clone", async ({ body }) => ({
      success: true,
      data: await vmSvc.cloneVm(db, body),
    }), {
      body: InfraModel.cloneVmBody,
      detail: { tags: ["Infra"], summary: "Clone VM" },
    })
    .get("/vms/:id/snapshots", async ({ params }) => ({
      success: true,
      data: await vmSvc.listSnapshots(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "List VM snapshots" },
    })
    .post("/vms/:id/snapshots", async ({ params, body }) => ({
      success: true,
      data: await vmSvc.snapshotVm(db, params.id, body.name, body.description),
    }), {
      params: InfraModel.idParams,
      body: InfraModel.createSnapshotBody,
      detail: { tags: ["Infra"], summary: "Create VM snapshot" },
    })
    .post("/vms/:id/snapshots/:name/restore", async ({ params }) => {
      await vmSvc.restoreSnapshot(db, params.id, params.name);
      return { success: true }
    }, {
      params: InfraModel.snapshotNameParams,
      detail: { tags: ["Infra"], summary: "Restore VM snapshot" },
    })
    .post("/vms/:id/snapshots/:name/delete", async ({ params }) => {
      await vmSvc.deleteSnapshot(db, params.id, params.name);
      return { success: true }
    }, {
      params: InfraModel.snapshotNameParams,
      detail: { tags: ["Infra"], summary: "Delete VM snapshot" },
    })
    .post("/vms/:id/delete", async ({ params }) => ({
      success: true,
      data: await vmSvc.destroyVm(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Destroy VM" },
    })

    // --- Hosts ---
    .get("/hosts", async ({ query }) => ({
      success: true,
      data: await hostSvc.listHosts(db, query),
    }), {
      query: InfraModel.listHostsQuery,
      detail: { tags: ["Infra"], summary: "List hosts" },
    })
    .get("/hosts/:id", async ({ params, set }) => {
      const row = await hostSvc.getHost(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get host" },
    })
    .post("/hosts", async ({ body }) => ({
      success: true,
      data: await hostSvc.addHost(db, body),
    }), {
      body: InfraModel.createHostBody,
      detail: { tags: ["Infra"], summary: "Add host" },
    })
    .post("/hosts/:id/delete", async ({ params, set }) => {
      const row = await hostSvc.removeHost(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Remove host" },
    })

    // --- Kube Nodes ---
    .get("/kube-nodes", async ({ query }) => ({
      success: true,
      data: await kubeNodeSvc.listNodes(db, query),
    }), {
      query: InfraModel.listKubeNodesQuery,
      detail: { tags: ["Infra"], summary: "List kube nodes" },
    })
    .get("/kube-nodes/:id", async ({ params, set }) => {
      const row = await kubeNodeSvc.getNode(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get kube node" },
    })
    .post("/kube-nodes", async ({ body }) => ({
      success: true,
      data: await kubeNodeSvc.addNode(db, body),
    }), {
      body: InfraModel.createKubeNodeBody,
      detail: { tags: ["Infra"], summary: "Add kube node" },
    })
    .post("/kube-nodes/:id/delete", async ({ params, set }) => {
      const row = await kubeNodeSvc.removeNode(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Remove kube node" },
    })
    .post("/kube-nodes/:id/pause", async ({ params }) => ({
      success: true,
      data: await kubeNodeSvc.pauseNode(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Pause kube node scheduling" },
    })
    .post("/kube-nodes/:id/resume", async ({ params }) => ({
      success: true,
      data: await kubeNodeSvc.resumeNode(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Resume kube node scheduling" },
    })
    .post("/kube-nodes/:id/evacuate", async ({ params }) => ({
      success: true,
      data: await kubeNodeSvc.evacuateNode(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Evacuate kube node" },
    })

    // --- Subnets ---
    .get("/subnets", async ({ query }) => ({
      success: true,
      data: await ipamSvc.listSubnets(db, query),
    }), {
      query: InfraModel.listSubnetsQuery,
      detail: { tags: ["Infra"], summary: "List subnets" },
    })
    .get("/subnets/:id", async ({ params, set }) => {
      const row = await ipamSvc.getSubnet(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get subnet" },
    })
    .post("/subnets", async ({ body }) => ({
      success: true,
      data: await ipamSvc.createSubnet(db, body),
    }), {
      body: InfraModel.createSubnetBody,
      detail: { tags: ["Infra"], summary: "Create subnet" },
    })
    .post("/subnets/:id/delete", async ({ params, set }) => {
      const row = await ipamSvc.deleteSubnet(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Delete subnet" },
    })

    // --- IPs ---
    .get("/ips", async ({ query }) => ({
      success: true,
      data: await ipamSvc.listIps(db, query),
    }), {
      query: InfraModel.listIpsQuery,
      detail: { tags: ["Infra"], summary: "List IPs" },
    })
    .get("/ips/available", async ({ query }) => ({
      success: true,
      data: await ipamSvc.listAvailableIps(db, query.subnetId),
    }), {
      query: InfraModel.listAvailableIpsQuery,
      detail: { tags: ["Infra"], summary: "List available IPs" },
    })
    .get("/ips/stats", async ({ query }) => ({
      success: true,
      data: await ipamSvc.getIpamStats(db, query.subnetId),
    }), {
      query: InfraModel.ipamStatsQuery,
      detail: { tags: ["Infra"], summary: "IPAM stats" },
    })
    .post("/ips/lookup", async ({ body, set }) => {
      const row = await ipamSvc.lookupIp(db, body.address)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      body: InfraModel.lookupIpBody,
      detail: { tags: ["Infra"], summary: "Lookup IP by address" },
    })
    .post("/ips/register", async ({ body }) => ({
      success: true,
      data: await ipamSvc.registerIp(db, body),
    }), {
      body: InfraModel.registerIpBody,
      detail: { tags: ["Infra"], summary: "Register IP" },
    })
    .post("/ips/:id/assign", async ({ params, body }) => ({
      success: true,
      data: await ipamSvc.assignIp(db, params.id, body),
    }), {
      params: InfraModel.idParams,
      body: InfraModel.assignIpBody,
      detail: { tags: ["Infra"], summary: "Assign IP" },
    })
    .post("/ips/:id/release", async ({ params }) => ({
      success: true,
      data: await ipamSvc.releaseIp(db, params.id),
    }), {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Release IP" },
    })

    // --- Assets ---
    .get("/assets", async () => ({
      success: true,
      data: await assetsSvc.listAssets(db),
    }), {
      detail: { tags: ["Infra"], summary: "List all infra assets" },
    })
    .get("/assets/:id", async ({ params, set }) => {
      const row = await assetsSvc.getAsset(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: InfraModel.idParams,
      detail: { tags: ["Infra"], summary: "Get asset by ID" },
    })
}
