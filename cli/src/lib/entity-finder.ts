import { getFactoryClient } from "../client.js";
import { styleMuted, styleBold, styleError } from "../cli-style.js";

export type EntityType = 'workspace' | 'sandbox' | 'vm' | 'host';
export type Transport = 'ssh' | 'kubectl' | 'none';

export interface ResolvedEntity {
  type: EntityType;
  id: string;
  slug: string;
  displayName: string;
  status: string;
  runtimeType?: string;  // container | vm (for sandboxes)

  transport: Transport;

  // SSH fields
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;

  // kubectl fields
  podName?: string;
  namespace?: string;
  container?: string;
  kubeContext?: string;

  // Display
  context?: string;
  resourceSpec?: string;
}

export class EntityFinder {
  private apiPromise: ReturnType<typeof getFactoryClient>;

  constructor() {
    this.apiPromise = getFactoryClient();
  }

  /**
   * Resolve a single target by slug/name/id.
   * Searches: sandboxes → VMs → hosts → /access/resolve fallback
   */
  async resolve(target: string): Promise<ResolvedEntity | null> {
    const api = await this.apiPromise;

    // 1. Try sandboxes (covers workspaces + sandboxes)
    try {
      const result = await (api as any).api.v1.factory.infra.sandboxes.get({
        query: { slug: target },
      });
      const items = result?.data?.data ?? [];
      // Also try by ID
      if (items.length === 0) {
        try {
          const byId = await (api as any).api.v1.factory.infra.sandboxes({ id: target }).get();
          const sbx = byId?.data?.data ?? byId?.data;
          if (sbx?.sandboxId) items.push(sbx);
        } catch { /* not found by id */ }
      }
      if (items.length > 0) {
        return sandboxToEntity(items[0]);
      }
    } catch { /* endpoint may not exist or error */ }

    // 2. Try VMs
    try {
      const result = await (api as any).api.v1.factory.infra.vms.get({
        query: { slug: target },
      });
      const items = result?.data?.data ?? [];
      if (items.length === 0) {
        try {
          const byId = await (api as any).api.v1.factory.infra.vms({ id: target }).get();
          const vm = byId?.data?.data ?? byId?.data;
          if (vm?.vmId) items.push(vm);
        } catch { /* not found */ }
      }
      if (items.length > 0) {
        return vmToEntity(items[0]);
      }
    } catch { /* endpoint may not exist */ }

    // 3. Try hosts
    try {
      const result = await (api as any).api.v1.factory.infra.hosts.get({
        query: { slug: target },
      });
      const items = result?.data?.data ?? [];
      if (items.length === 0) {
        try {
          const byId = await (api as any).api.v1.factory.infra.hosts({ id: target }).get();
          const host = byId?.data?.data ?? byId?.data;
          if (host?.hostId) items.push(host);
        } catch { /* not found */ }
      }
      if (items.length > 0) {
        return hostToEntity(items[0]);
      }
    } catch { /* endpoint may not exist */ }

    // 4. Fallback to existing /access/resolve
    try {
      const result = await (api as any).api.v1.factory.infra.access.resolve({ slug: target }).get();
      const data = result?.data?.data;
      if (data) {
        return {
          type: (data.kind === 'vm' ? 'vm' : data.kind === 'host' ? 'host' : 'sandbox') as EntityType,
          id: data.id ?? target,
          slug: target,
          displayName: data.name ?? target,
          status: 'unknown',
          transport: 'ssh',
          sshHost: data.host,
          sshPort: data.port ?? 22,
          sshUser: data.user ?? 'root',
        };
      }
    } catch { /* not found */ }

    return null;
  }

  /**
   * List all SSHable entities for interactive picker.
   */
  async list(): Promise<ResolvedEntity[]> {
    const api = await this.apiPromise;
    const entities: ResolvedEntity[] = [];

    // Fetch in parallel
    const [sandboxes, vms, hosts] = await Promise.allSettled([
      (api as any).api.v1.factory.infra.sandboxes.get().then((r: any) => r?.data?.data ?? []),
      (api as any).api.v1.factory.infra.vms.get().then((r: any) => r?.data?.data ?? []),
      (api as any).api.v1.factory.infra.hosts.get().then((r: any) => r?.data?.data ?? []),
    ]);

    if (sandboxes.status === 'fulfilled') {
      for (const sbx of sandboxes.value) {
        const entity = sandboxToEntity(sbx);
        if (entity) entities.push(entity);
      }
    }

    if (vms.status === 'fulfilled') {
      for (const vm of vms.value) {
        const entity = vmToEntity(vm);
        if (entity) entities.push(entity);
      }
    }

    if (hosts.status === 'fulfilled') {
      for (const host of hosts.value) {
        const entity = hostToEntity(host);
        if (entity) entities.push(entity);
      }
    }

    return entities;
  }
}

function sandboxToEntity(sbx: any): ResolvedEntity | null {
  if (!sbx) return null;
  const runtimeType = sbx.runtimeType ?? 'container';
  const ownerType = sbx.ownerType ?? 'user';
  const isContainer = runtimeType === 'container';

  return {
    type: ownerType === 'user' ? 'workspace' : 'sandbox',
    id: sbx.sandboxId,
    slug: sbx.slug ?? sbx.sandboxId,
    displayName: sbx.name ?? sbx.slug ?? sbx.sandboxId,
    status: sbx.status ?? sbx.healthStatus ?? 'unknown',
    runtimeType,
    transport: isContainer ? 'kubectl' : 'ssh',
    // SSH (VM-backed)
    sshHost: sbx.sshHost ?? sbx.ipAddress,
    sshPort: sbx.sshPort ?? 22,
    sshUser: 'root',
    // kubectl (container)
    podName: isContainer ? (sbx.podName ?? `sandbox-${sbx.slug}`) : undefined,
    namespace: isContainer ? `sandbox-${sbx.slug}` : undefined,
    container: isContainer ? 'workspace' : undefined,
  };
}

function vmToEntity(vm: any): ResolvedEntity | null {
  if (!vm) return null;
  return {
    type: 'vm',
    id: vm.vmId,
    slug: vm.slug ?? vm.vmId,
    displayName: vm.name ?? vm.slug ?? vm.vmId,
    status: vm.status ?? 'unknown',
    transport: 'ssh',
    sshHost: vm.ipAddress,
    sshPort: 22,
    sshUser: vm.accessUser ?? 'root',
  };
}

function hostToEntity(host: any): ResolvedEntity | null {
  if (!host) return null;
  return {
    type: 'host',
    id: host.hostId,
    slug: host.slug ?? host.hostId,
    displayName: host.name ?? host.displayName ?? host.slug ?? host.hostId,
    status: host.status ?? 'unknown',
    transport: 'ssh',
    sshHost: host.ipAddress,
    sshPort: 22,
    sshUser: 'root',
  };
}
