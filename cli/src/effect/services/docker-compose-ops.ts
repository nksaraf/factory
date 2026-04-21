import { Context, Effect } from "effect"
import type {
  ExecutorError,
  DockerNotAvailableError,
  BuildError,
} from "../errors/site.js"

export interface ComposeUpOpts {
  readonly detach?: boolean
  readonly build?: boolean
  readonly noBuild?: boolean
  readonly noDeps?: boolean
  readonly wait?: boolean
  readonly services?: string[]
  readonly profiles?: string[]
}

export interface DockerComposeOpsService {
  readonly build: (
    services: string[]
  ) => Effect.Effect<void, ExecutorError | BuildError>
  readonly stop: (services: string[]) => Effect.Effect<void, ExecutorError>
  readonly up: (
    opts: ComposeUpOpts
  ) => Effect.Effect<void, ExecutorError | DockerNotAvailableError>
  readonly isDockerRunning: Effect.Effect<boolean>
}

export class DockerComposeOpsTag extends Context.Tag("DockerComposeOps")<
  DockerComposeOpsTag,
  DockerComposeOpsService
>() {}
