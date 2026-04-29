import { Effect, Layer } from "effect"
import {
  ProcessManager,
  ProcessManagerLive,
  type IProcessManager,
} from "@smp/factory-shared/effect/process-manager"
import {
  SshAdapter,
  KubectlAdapter,
} from "@smp/factory-shared/effect/transport-adapter"

import { styleBold, styleError, styleMuted } from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import { RemoteAccess, RemoteAccessLive, runEffect } from "../effect/index.js"
import type {
  AccessTarget,
  SshTransport,
  KubectlTransport,
} from "../effect/services/remote-access.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("exec", [
  "$ dx exec my-workbench -- ls -la         Run command in workbench",
  "$ dx exec my-vm -- docker ps             Run command on VM via SSH",
  "$ dx exec my-workbench -- /bin/bash      Open shell in workbench",
  "$ dx exec my-vm --dir /app -- make build Run in specific directory",
])

function wrapCommand(
  cmd: string[],
  opts: { dir?: string; sudo?: boolean }
): string {
  let command = cmd.join(" ")
  if (opts.dir) {
    command = `cd ${opts.dir} && ${command}`
  }
  if (opts.sudo) {
    command = `sudo ${command}`
  }
  return command
}

export function execCommand(app: DxBase) {
  return app
    .sub("exec")
    .meta({ description: "Run a command on a remote machine" })
    .args([
      {
        name: "target",
        type: "string",
        required: true,
        description: "Machine name/slug to exec into",
      },
    ])
    .flags({
      container: {
        type: "string",
        short: "c",
        description: 'Container name (for k8s targets, default: "workbench")',
      },
      context: {
        type: "string",
        description: "kubectl context override",
      },
      dir: {
        type: "string",
        description: "Working directory on remote machine",
      },
      sudo: {
        type: "boolean",
        description: "Run command with sudo",
      },
      user: {
        type: "string",
        short: "l",
        description: "Override SSH user",
      },
    })
    .run(async ({ args, flags }) => {
      const dashIdx = process.argv.indexOf("--")
      const cmd = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : ["/bin/bash"]

      const program = Effect.gen(function* () {
        const access = yield* RemoteAccess
        const target = yield* access.resolve(args.target)
        const pm = yield* ProcessManager

        if (target.transport.kind === "local") {
          console.error(
            styleError(
              `"${target.displayName}" (${target.entityType}) does not support exec.`
            )
          )
          process.exit(1)
        }

        const remoteCommand = wrapCommand(cmd, {
          dir: flags.dir as string,
          sudo: flags.sudo as boolean,
        })

        if (target.transport.kind === "kubectl") {
          const adapter = new KubectlAdapter({
            podName: target.transport.podName,
            namespace: target.transport.namespace,
            container:
              (flags.container as string) ?? target.transport.container,
            kubeContext:
              (flags.context as string) ?? target.transport.kubeContext,
          })
          const execCmd = adapter.buildCmd(remoteCommand)
          return yield* pm.interactive({ cmd: execCmd })
        }

        const transport = target.transport as SshTransport
        const adapter = new SshAdapter({
          host: transport.host,
          port: transport.port,
          user: (flags.user as string) ?? transport.user,
          identity: transport.identity,
          jumpChain: [...transport.jumpChain],
        })
        const execCmd = adapter.buildCmd(remoteCommand)
        return yield* pm.interactive({ cmd: execCmd })
      })

      const layer = Layer.mergeAll(RemoteAccessLive, ProcessManagerLive)
      const exitCode = await runEffect(Effect.provide(program, layer), "exec")
      if (exitCode !== 0) process.exit(exitCode)
    })
}
