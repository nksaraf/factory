import { and, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../../db/connection";
import type { HostSpec } from "@smp/factory-shared/schemas/infra";
import { host, runtime } from "../../db/schema/infra-v2";
import { workspace } from "../../db/schema/ops";

/**
 * Unified SSH target resolved from a slug.
 * Searched across workspaces, VMs, and hosts.
 */
export interface SshTarget {
  kind: "workspace" | "host";
  id: string;
  slug: string;
  name: string;
  host: string;
  port: number;
  user: string;
  status: string;
  jumpHost?: string;
  jumpUser?: string;
  jumpPort?: number;
  identityFile?: string;
}

/**
 * Resolve a slug to an SSH-connectable target.
 * Search order: workspaces → VMs → hosts.
 * Accepts either a slug or an ID.
 */
export async function resolveTarget(
  db: Database,
  slug: string
): Promise<SshTarget | null> {
  // 1. Workspaces (lifecycle + SSH config live in spec JSONB)
  const wsRows = await db
    .select()
    .from(workspace)
    .where(and(
      or(eq(workspace.slug, slug), eq(workspace.id, slug)),
      isNull(workspace.systemTo),
      isNull(workspace.validTo),
    ));
  const wsRow = wsRows[0];
  const wsSpec = wsRow?.spec;
  if (wsRow && wsSpec?.sshHost && wsSpec?.sshPort) {
    let sshHost = wsSpec.sshHost;
    if (isLoopback(sshHost) && wsRow.runtimeId) {
      const [rt] = await db.select().from(runtime).where(eq(runtime.id, wsRow.runtimeId));
      sshHost = rt?.spec?.endpoint ?? endpointFromKubeconfig(rt?.spec?.kubeconfigRef) ?? sshHost;
    }
    return {
      kind: "workspace",
      id: wsRow.id,
      slug: wsRow.slug,
      name: wsRow.name,
      host: sshHost,
      port: wsSpec.sshPort,
      user: "root",
      status: wsSpec.lifecycle ?? "unknown",
    };
  }

  // 2. Hosts (v2 schema — SSH config lives in spec JSONB)
  const hostRows = await db
    .select()
    .from(host)
    .where(or(eq(host.slug, slug), eq(host.id, slug)));
  const hostRow = hostRows[0];
  const hostSpec = hostRow?.spec as HostSpec | undefined;
  const hostIp = hostSpec?.ipAddress ?? hostSpec?.hostname;
  if (hostRow && hostIp) {
    return {
      kind: "host",
      id: hostRow.id,
      slug: hostRow.slug,
      name: hostRow.name,
      host: hostIp,
      port: hostSpec?.sshPort ?? 22,
      user: hostSpec?.accessUser ?? "root",
      status: hostSpec?.lifecycle ?? "active",
      jumpHost: hostSpec?.jumpHost,
      jumpUser: hostSpec?.jumpUser,
      jumpPort: hostSpec?.jumpPort,
      identityFile: hostSpec?.identityFile,
    };
  }

  return null;
}

/**
 * List all SSH-connectable targets for SSH config generation.
 */
export async function listTargets(db: Database): Promise<SshTarget[]> {
  const targets: SshTarget[] = [];

  // Workspaces with SSH access (lifecycle + SSH config in spec JSONB)
  const wsRows = await db.select().from(workspace).where(
    and(isNull(workspace.systemTo), isNull(workspace.validTo))
  );

  // Pre-fetch runtimes to resolve localhost sshHost → actual runtime endpoint
  const runtimeIds = [...new Set(wsRows.map((r) => r.runtimeId).filter(Boolean))] as string[];
  const runtimeById = new Map<string, string>();
  if (runtimeIds.length > 0) {
    const runtimes = await db.select().from(runtime).where(
      or(...runtimeIds.map((id) => eq(runtime.id, id)))!
    );
    for (const rt of runtimes) {
      const endpoint = rt.spec?.endpoint ?? endpointFromKubeconfig(rt.spec?.kubeconfigRef);
      if (endpoint) runtimeById.set(rt.id, endpoint);
    }
  }

  for (const row of wsRows) {
    const spec = row.spec;
    if (spec.sshHost && spec.sshPort && spec.lifecycle === "active") {
      let sshHost = spec.sshHost;
      // Resolve localhost/loopback to the runtime's actual endpoint
      if (isLoopback(sshHost) && row.runtimeId) {
        sshHost = runtimeById.get(row.runtimeId) ?? sshHost;
      }
      if (isLoopback(sshHost)) continue; // skip unresolvable localhost targets
      targets.push({
        kind: "workspace",
        id: row.id,
        slug: row.slug,
        name: row.name,
        host: sshHost,
        port: spec.sshPort,
        user: "root",
        status: spec.lifecycle,
      });
    }
  }

  // Hosts — read SSH config from spec JSONB
  const allHosts = await db.select().from(host);
  for (const hostRow of allHosts) {
    const spec = hostRow.spec as HostSpec | undefined;
    const ip = spec?.ipAddress ?? spec?.hostname;
    const accessMethod = spec?.accessMethod ?? "ssh";
    const lifecycle = spec?.lifecycle ?? "active";
    if (ip && accessMethod === "ssh" && lifecycle === "active") {
      targets.push({
        kind: "host",
        id: hostRow.id,
        slug: hostRow.slug,
        name: hostRow.name,
        host: ip,
        port: spec?.sshPort ?? 22,
        user: spec?.accessUser ?? "root",
        status: lifecycle,
        jumpHost: spec?.jumpHost,
        jumpUser: spec?.jumpUser,
        jumpPort: spec?.jumpPort,
        identityFile: spec?.identityFile,
      });
    }
  }

  return targets;
}

// ── Helpers ──────────────────────────────────────────────────

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

function endpointFromKubeconfig(kubeconfig: string | undefined): string | null {
  if (!kubeconfig) return null;
  const match = kubeconfig.match(/server:\s*https?:\/\/([^:/\s]+)/);
  if (!match) return null;
  const h = match[1];
  if (isLoopback(h) || h === "host.docker.internal") return null;
  return h;
}
