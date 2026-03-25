import type { TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

import type { TunnelBackend, TunnelHandle } from "../tunnel-backend.js";

/**
 * SshBackend — SSH tunnel backend.
 * NOT YET IMPLEMENTED. Will spawn `ssh -L` tunnels to forward
 * remote services through SSH bastion hosts.
 */
export class SshBackend implements TunnelBackend {
  readonly kind = "ssh" as const;

  async start(_spec: TunnelSpec): Promise<TunnelHandle> {
    throw new Error(
      "SSH tunnel backend not yet implemented — use direct connections or set up network access to the target"
    );
  }

  async stop(_handle: TunnelHandle): Promise<void> {
    throw new Error("SSH tunnel backend not yet implemented");
  }

  async checkHealth(_handle: TunnelHandle): Promise<boolean> {
    throw new Error("SSH tunnel backend not yet implemented");
  }
}
