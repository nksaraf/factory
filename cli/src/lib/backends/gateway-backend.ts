import type { TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

import type { TunnelBackend, TunnelHandle } from "../tunnel-backend.js";

/**
 * GatewayBackend — Factory-brokered tunnel backend.
 * NOT YET IMPLEMENTED. Will provision temporary routes through
 * site gateway infrastructure via the Factory API.
 *
 * Future: dx registers local services with the Factory API,
 * which provisions temporary routes through site gateways.
 */
export class GatewayBackend implements TunnelBackend {
  readonly kind = "gateway" as const;

  async start(_spec: TunnelSpec): Promise<TunnelHandle> {
    throw new Error(
      "Gateway tunnel backend not yet implemented — gateway infrastructure is not yet available. Use direct connections for now."
    );
  }

  async stop(_handle: TunnelHandle): Promise<void> {
    throw new Error("Gateway tunnel backend not yet implemented");
  }

  async checkHealth(_handle: TunnelHandle): Promise<boolean> {
    throw new Error("Gateway tunnel backend not yet implemented");
  }
}
