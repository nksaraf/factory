import { Context, Effect, Scope } from "effect"
import type { TunnelError } from "../errors/site.js"

export interface TunnelOpts {
  readonly subdomain: string
  readonly port: number
  readonly publishPorts: number[]
  readonly portMap?: Map<number, number>
  readonly exposeConsole?: boolean
}

export interface TunnelInfo {
  readonly url: string
  readonly subdomain: string
  readonly portUrls?: Array<{ port: number; url: string }>
}

export type TunnelStatus = "disconnected" | "connecting" | "connected" | "error"

export interface TunnelState {
  readonly status: TunnelStatus
  readonly info?: TunnelInfo
}

export interface ITunnelManager {
  readonly open: (
    opts: TunnelOpts
  ) => Effect.Effect<TunnelInfo, TunnelError, Scope.Scope>
  readonly getState: Effect.Effect<TunnelState>
}

export class TunnelManager extends Context.Tag("TunnelManager")<
  TunnelManager,
  ITunnelManager
>() {}
