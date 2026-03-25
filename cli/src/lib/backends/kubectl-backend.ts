import type { TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

import type { TunnelBackend, TunnelHandle } from "../tunnel-backend.js";

/**
 * KubectlBackend — kubectl port-forward tunnel backend.
 * NOT YET IMPLEMENTED. Will spawn `kubectl port-forward` processes
 * to tunnel K8s services to localhost.
 */
export class KubectlBackend implements TunnelBackend {
  readonly kind = "kubectl" as const;

  async start(_spec: TunnelSpec): Promise<TunnelHandle> {
    throw new Error(
      "kubectl tunnel backend not yet implemented — use direct connections or set up network access to the target"
    );
  }

  async stop(_handle: TunnelHandle): Promise<void> {
    throw new Error("kubectl tunnel backend not yet implemented");
  }

  async checkHealth(_handle: TunnelHandle): Promise<boolean> {
    throw new Error("kubectl tunnel backend not yet implemented");
  }
}
