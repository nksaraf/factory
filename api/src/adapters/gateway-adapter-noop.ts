import { logger } from "../logger"
import type { GatewayAdapter, GatewayCRD, ApplyResult } from "./gateway-adapter"

export class NoopGatewayAdapter implements GatewayAdapter {
  readonly type = "noop"

  private store = new Map<string, GatewayCRD>()

  async apply(crds: GatewayCRD[]): Promise<ApplyResult> {
    logger.info(
      { count: crds.length, names: crds.map((c) => c.metadata.name) },
      "noop gateway adapter: apply"
    )
    for (const crd of crds) {
      this.store.set(crd.metadata.name, crd)
    }
    return { applied: crds.length, errors: [] }
  }

  async getCurrentState(): Promise<GatewayCRD[]> {
    logger.info(
      { count: this.store.size },
      "noop gateway adapter: getCurrentState"
    )
    return Array.from(this.store.values())
  }

  async delete(names: string[]): Promise<void> {
    logger.info({ names }, "noop gateway adapter: delete")
    for (const name of names) {
      this.store.delete(name)
    }
  }

  reset(): void {
    this.store.clear()
  }
}
