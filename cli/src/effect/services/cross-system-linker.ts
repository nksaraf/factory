import { Context, Effect } from "effect"

export interface CrossSystemLink {
  readonly slug: string
  readonly systemSlug: string
  readonly linkedRef: { site: string; systemDeployment: string }
  readonly env: Record<string, string>
}

export interface CrossSystemLinkOpts {
  readonly connects: string[]
  readonly connectTo?: string
}

export interface CrossSystemLinkerService {
  readonly resolve: (
    opts: CrossSystemLinkOpts
  ) => Effect.Effect<CrossSystemLink[]>
  readonly apply: (
    links: CrossSystemLink[],
    connectionEnv: Record<string, string>
  ) => Effect.Effect<Record<string, string>>
}

export class CrossSystemLinkerTag extends Context.Tag("CrossSystemLinker")<
  CrossSystemLinkerTag,
  CrossSystemLinkerService
>() {}
