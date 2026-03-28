import { eq, or } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { host, vm } from "../../db/schema/infra";
import { sandbox, deploymentTarget } from "../../db/schema/fleet";

/**
 * Unified SSH target resolved from a slug.
 * Searched across sandboxes, VMs, and hosts.
 */
export interface SshTarget {
  kind: "sandbox" | "vm" | "host";
  id: string;
  slug: string;
  name: string;
  host: string;
  port: number;
  user: string;
  status: string;
}

/**
 * Resolve a slug to an SSH-connectable target.
 * Search order: sandboxes → VMs → hosts.
 * Accepts either a slug or an ID.
 */
export async function resolveTarget(
  db: Database,
  slug: string
): Promise<SshTarget | null> {
  // 1. Sandboxes (status lives on deploymentTarget)
  const sbxRows = await db
    .select({ sandbox, status: deploymentTarget.status })
    .from(sandbox)
    .innerJoin(deploymentTarget, eq(sandbox.deploymentTargetId, deploymentTarget.deploymentTargetId))
    .where(or(eq(sandbox.slug, slug), eq(sandbox.sandboxId, slug)));
  const sbxRow = sbxRows[0];
  if (sbxRow && sbxRow.sandbox.sshHost && sbxRow.sandbox.sshPort) {
    return {
      kind: "sandbox",
      id: sbxRow.sandbox.sandboxId,
      slug: sbxRow.sandbox.slug,
      name: sbxRow.sandbox.name,
      host: sbxRow.sandbox.sshHost,
      port: sbxRow.sandbox.sshPort,
      user: "coder",
      status: sbxRow.status,
    };
  }

  // 2. VMs
  const vmRows = await db
    .select()
    .from(vm)
    .where(or(eq(vm.slug, slug), eq(vm.vmId, slug)));
  const vmRow = vmRows[0];
  if (vmRow && vmRow.ipAddress) {
    return {
      kind: "vm",
      id: vmRow.vmId,
      slug: vmRow.slug,
      name: vmRow.name,
      host: vmRow.ipAddress,
      port: 22,
      user: vmRow.accessUser ?? "root",
      status: vmRow.status,
    };
  }

  // 3. Hosts
  const hostRows = await db
    .select()
    .from(host)
    .where(or(eq(host.slug, slug), eq(host.hostId, slug)));
  const hostRow = hostRows[0];
  if (hostRow && hostRow.ipAddress) {
    return {
      kind: "host",
      id: hostRow.hostId,
      slug: hostRow.slug,
      name: hostRow.name,
      host: hostRow.ipAddress,
      port: 22,
      user: "root",
      status: hostRow.status,
    };
  }

  return null;
}

/**
 * List all SSH-connectable targets for SSH config generation.
 */
export async function listTargets(db: Database): Promise<SshTarget[]> {
  const targets: SshTarget[] = [];

  // Sandboxes with SSH access (status on deploymentTarget)
  const sbxRows = await db
    .select({ sandbox, status: deploymentTarget.status })
    .from(sandbox)
    .innerJoin(deploymentTarget, eq(sandbox.deploymentTargetId, deploymentTarget.deploymentTargetId));
  for (const row of sbxRows) {
    if (row.sandbox.sshHost && row.sandbox.sshPort && row.status === "active") {
      targets.push({
        kind: "sandbox",
        id: row.sandbox.sandboxId,
        slug: row.sandbox.slug,
        name: row.sandbox.name,
        host: row.sandbox.sshHost,
        port: row.sandbox.sshPort,
        user: "coder",
        status: row.status,
      });
    }
  }

  // VMs with IPs
  const vmRows = await db.select().from(vm);
  for (const vmRow of vmRows) {
    if (vmRow.ipAddress && vmRow.accessMethod === "ssh" && vmRow.status === "running") {
      targets.push({
        kind: "vm",
        id: vmRow.vmId,
        slug: vmRow.slug,
        name: vmRow.name,
        host: vmRow.ipAddress,
        port: 22,
        user: vmRow.accessUser ?? "root",
        status: vmRow.status,
      });
    }
  }

  // Hosts with IPs
  const hostRows = await db.select().from(host);
  for (const hostRow of hostRows) {
    if (hostRow.ipAddress && hostRow.accessMethod === "ssh" && hostRow.status === "active") {
      targets.push({
        kind: "host",
        id: hostRow.hostId,
        slug: hostRow.slug,
        name: hostRow.name,
        host: hostRow.ipAddress,
        port: 22,
        user: "root",
        status: hostRow.status,
      });
    }
  }

  return targets;
}
