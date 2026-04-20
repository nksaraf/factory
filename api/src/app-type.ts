import type { FactoryAPI } from "./factory.api"

/**
 * Elysia app shape for Eden clients.
 * The TypeScript CLI mirrors this as `factory/cli/src/factory-app-type.ts` to avoid pulling Vinxi into `tsc`.
 */
// @ts-ignore TS2589 — Elysia's deep type inference exceeds TS recursion limit
export type FactoryApp = ReturnType<FactoryAPI["createApp"]>
