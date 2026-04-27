import { FetchHttpClient } from "@effect/platform"
import { RpcClient, RpcSerialization } from "@effect/rpc"
import { Effect, Layer, Stream, Fiber, type Scope } from "effect"
import { WorkbenchRpcs } from "@smp/factory-shared/effect/workbench-rpc"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

type WorkbenchClient = RpcClient.RpcClient<typeof WorkbenchRpcs>

function makeWorkbenchRuntime(agentUrl: string) {
  const protocol = RpcClient.layerProtocolHttp({ url: `${agentUrl}/rpc` }).pipe(
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson])
  )
  return { protocol }
}

export interface WorkbenchConnectionState {
  agentUrl: string
  status: "connected" | "disconnected" | "error"
  call: <A, E>(
    fn: (client: WorkbenchClient) => Effect.Effect<A, E>
  ) => Promise<A>
  subscribe: <A, E>(
    fn: (client: WorkbenchClient) => Stream.Stream<A, E>,
    onItem: (item: A) => void,
    onError?: (error: E) => void,
    onEnd?: () => void
  ) => () => void
}

const WorkbenchContext = createContext<WorkbenchConnectionState | null>(null)
export const WorkbenchProvider = WorkbenchContext.Provider

export function useWorkbenchConnection(): WorkbenchConnectionState | null {
  return useContext(WorkbenchContext)
}

export function useWorkbenchClient(agentUrl: string): WorkbenchConnectionState {
  const [status, setStatus] = useState<"connected" | "disconnected" | "error">(
    "disconnected"
  )
  const runtimeRef = useRef(makeWorkbenchRuntime(agentUrl))

  useEffect(() => {
    runtimeRef.current = makeWorkbenchRuntime(agentUrl)
    setStatus("disconnected")
    return () => setStatus("disconnected")
  }, [agentUrl])

  const call = useCallback(
    async <A, E>(
      fn: (client: WorkbenchClient) => Effect.Effect<A, E>
    ): Promise<A> => {
      const program = Effect.gen(function* () {
        const client = yield* RpcClient.make(WorkbenchRpcs)
        return yield* fn(client)
      }).pipe(Effect.scoped, Effect.provide(runtimeRef.current.protocol))

      try {
        const result = await Effect.runPromise(program as Effect.Effect<A>)
        setStatus("connected")
        return result
      } catch (e) {
        setStatus("error")
        throw e
      }
    },
    []
  )

  const subscribe = useCallback(
    <A, E>(
      fn: (client: WorkbenchClient) => Stream.Stream<A, E>,
      onItem: (item: A) => void,
      onError?: (error: E) => void,
      onEnd?: () => void
    ): (() => void) => {
      const program = Effect.gen(function* () {
        const client = yield* RpcClient.make(WorkbenchRpcs)
        const stream = fn(client)
        yield* Stream.runForEach(stream, (item) =>
          Effect.sync(() => onItem(item))
        )
      }).pipe(Effect.scoped, Effect.provide(runtimeRef.current.protocol))

      const fiber = Effect.runFork(
        (program as Effect.Effect<void>).pipe(
          Effect.tapErrorCause((cause) =>
            Effect.sync(() => {
              if (onError) onError(cause as unknown as E)
              setStatus("error")
            })
          ),
          Effect.ensuring(Effect.sync(() => onEnd?.()))
        )
      )

      setStatus("connected")

      return () => {
        Effect.runFork(Fiber.interrupt(fiber))
      }
    },
    []
  )

  return useMemo(
    () => ({ agentUrl, status, call, subscribe }),
    [agentUrl, status, call, subscribe]
  )
}
