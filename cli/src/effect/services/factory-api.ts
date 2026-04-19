/**
 * FactoryApi — Effect service tag for CLI commands that call the Factory API.
 *
 * Commands depend on `FactoryApi` via the Effect context; the live layer
 * (in ../layers/factory-api.ts) provides the implementation by wrapping the
 * existing FactoryClient.
 */

import { Context, Effect } from "effect"
import type {
  EntityNotFoundError,
  AuthenticationError,
  ApiUnreachableError,
} from "@smp/factory-shared/effect/errors"

export class FactoryApi extends Context.Tag("FactoryApi")<
  FactoryApi,
  {
    readonly request: <T>(
      method: string,
      path: string,
      body?: unknown
    ) => Effect.Effect<
      T,
      ApiUnreachableError | AuthenticationError | EntityNotFoundError
    >

    readonly listEntities: (
      kind: string,
      query?: Record<string, string>
    ) => Effect.Effect<
      { data: unknown[]; total?: number },
      ApiUnreachableError | AuthenticationError
    >

    readonly getEntity: (
      kind: string,
      slugOrId: string
    ) => Effect.Effect<
      unknown,
      ApiUnreachableError | AuthenticationError | EntityNotFoundError
    >

    readonly createEntity: (
      kind: string,
      body: unknown
    ) => Effect.Effect<unknown, ApiUnreachableError | AuthenticationError>

    readonly entityAction: (
      kind: string,
      id: string,
      action: string,
      body?: unknown
    ) => Effect.Effect<
      unknown,
      ApiUnreachableError | AuthenticationError | EntityNotFoundError
    >

    readonly deleteEntity: (
      kind: string,
      id: string
    ) => Effect.Effect<
      void,
      ApiUnreachableError | AuthenticationError | EntityNotFoundError
    >
  }
>() {}
