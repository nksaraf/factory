import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import type { DxBase } from "../dx-root.js"
import {
  resolveMachine,
  buildDockerEnv,
  buildSshArgs,
  checkLocalDocker,
  needsSync,
  findComposeFile,
  syncAndRunCompose,
  saveLocalMachine,
  removeLocalMachine,
} from "../handlers/docker-remote.js"
import { runRecipe } from "../handlers/run.js"
import {
  styleBold,
  styleMuted,
  styleSuccess,
  styleError,
} from "./list-helpers.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("docker", [
  "$ dx docker ps --on staging-1              List containers on staging-1",
  "$ dx docker compose up -d --on prod-vm     Deploy compose stack to prod-vm",
  "$ dx docker connect staging-1              Open shell targeting staging-1",
  "$ eval $(dx docker env staging-1)          Set DOCKER_HOST for current shell",
  "$ dx docker setup fresh-vm                 Install Docker on a new machine",
  "$ dx docker add my-server --host 10.0.0.5  Register a machine locally",
])

export function dockerCommand(app: DxBase) {
  return (
    app
      .sub("docker")
      .meta({ description: "Run Docker commands on remote machines" })

      // ── dx docker [...args] --on <slug> ── proxy mode ──
      .args([
        {
          name: "cmd",
          type: "string",
          variadic: true,
          description: "Docker command and arguments to pass through",
        },
      ])
      .flags({
        on: {
          type: "string",
          description: "Target machine slug to run Docker commands on",
        },
      })
      .run(async ({ args, flags }) => {
        const raw = args.cmd ?? []
        const dockerArgs = Array.isArray(raw)
          ? (raw as string[])
          : [raw as string]
        const slug = flags.on as string | undefined

        if (!slug && dockerArgs.length === 0) {
          console.log(
            styleBold("dx docker") +
              " — Run Docker commands on remote machines\n"
          )
          console.log("Usage:")
          console.log(
            "  dx docker <command> --on <machine>     Proxy a docker command to a remote machine"
          )
          console.log(
            "  dx docker compose <args> --on <machine> Run docker compose on a remote machine"
          )
          console.log(
            "  dx docker connect <machine>            Open a shell connected to a remote Docker daemon"
          )
          console.log(
            "  dx docker env <machine>                Print DOCKER_HOST export commands"
          )
          console.log(
            "  dx docker setup <machine>              Install Docker on a remote machine"
          )
          console.log(
            "  dx docker add <name> --host <ip>       Register a machine locally"
          )
          console.log(
            "  dx docker remove <name>                Remove a locally registered machine"
          )
          console.log("")
          console.log(
            "Machine resolution: Factory API → ~/.ssh/config → ~/.config/dx/machines.json"
          )
          console.log("")
          console.log("Examples:")
          console.log(styleMuted("  dx docker ps --on staging-1"))
          console.log(styleMuted("  dx docker compose up -d --on prod-vm"))
          console.log(styleMuted("  dx docker connect staging-1"))
          console.log(styleMuted("  eval $(dx docker env staging-1)"))
          console.log(styleMuted("  dx docker setup fresh-vm"))
          return
        }

        if (!slug) {
          // No --on flag, just proxy to local docker
          checkLocalDocker()
          try {
            execFileSync("docker", dockerArgs, { stdio: "inherit" })
          } catch (err: any) {
            if (err.status != null) process.exit(err.status)
            throw err
          }
          return
        }

        checkLocalDocker()
        const target = await resolveMachine(slug)
        console.log(
          styleMuted(
            `Targeting ${styleBold(target.name)} (${target.kind}) via ${target.dockerHost}`
          )
        )

        try {
          execFileSync("docker", dockerArgs, {
            stdio: "inherit",
            env: buildDockerEnv(target),
          })
        } catch (err: any) {
          if (err.status != null) process.exit(err.status)
          throw err
        }
      })

      // ── dx docker compose [...args] --on <slug> ──
      .command("compose", (c) =>
        c
          .meta({ description: "Run docker compose on a remote machine" })
          .args([
            {
              name: "cmd",
              type: "string",
              variadic: true,
              description: "Docker compose arguments",
            },
          ])
          .flags({
            on: {
              type: "string",
              description: "Target machine slug",
            },
            project: {
              type: "string",
              short: "p",
              description: "Compose project name on the target machine",
            },
            dir: {
              type: "string",
              short: "d",
              description:
                "Project directory on the target machine (where compose file lives)",
            },
            sync: {
              type: "boolean",
              description:
                "Force sync of compose files to remote (auto-detected by default, use --no-sync to disable)",
            },
            file: {
              type: "string",
              short: "f",
              description: "Compose file path (default: auto-detected)",
            },
          })
          .run(async ({ args, flags }) => {
            const rawCmd = args.cmd ?? []
            const composeArgs = Array.isArray(rawCmd)
              ? (rawCmd as string[])
              : [rawCmd as string]
            const slug = flags.on as string | undefined
            const projectName = flags.project as string | undefined
            const projectDir = flags.dir as string | undefined

            if (!slug) {
              // No --on, proxy to local docker compose
              checkLocalDocker()
              const localArgs = ["compose"]
              if (projectName) localArgs.push("-p", projectName)
              if (projectDir) localArgs.push("--project-directory", projectDir)
              if (flags.file) localArgs.push("-f", flags.file as string)
              localArgs.push(...composeArgs)
              try {
                execFileSync("docker", localArgs, { stdio: "inherit" })
              } catch (err: any) {
                if (err.status != null) process.exit(err.status)
                throw err
              }
              return
            }

            const target = await resolveMachine(slug)
            console.log(
              styleMuted(
                `Targeting ${styleBold(target.name)} (${target.kind}) via ${target.dockerHost}`
              )
            )

            // When --dir or --project is given, run docker compose over SSH
            // directly on the remote machine (the paths are remote paths).
            if (projectDir || projectName) {
              const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
              const parts = ["docker", "compose"]
              if (projectName) parts.push("-p", shellEscape(projectName))
              if (projectDir)
                parts.push("--project-directory", shellEscape(projectDir))
              if (flags.file)
                parts.push("-f", shellEscape(flags.file as string))
              parts.push(...composeArgs.map(shellEscape))
              const remoteCmd = parts.join(" ")
              const sshArgs = buildSshArgs(target)
              try {
                execFileSync("ssh", [...sshArgs, remoteCmd], {
                  stdio: "inherit",
                })
              } catch (err: any) {
                if (err.status != null) process.exit(err.status)
                throw err
              }
              return
            }

            // Only auto-detect compose files for sync when the user
            // explicitly pointed at a local file. Otherwise just passthrough
            // via DOCKER_HOST (the remote already has its own project).
            const explicitFile = flags.file as string | undefined
            const composeFile = explicitFile ?? undefined

            const shouldSync =
              flags.sync === true ||
              (flags.sync !== false &&
                composeFile != null &&
                needsSync(composeFile))

            if (shouldSync && composeFile) {
              console.log(
                styleMuted(
                  "Build context or local volumes detected — syncing files to remote..."
                )
              )
              syncAndRunCompose(target, resolve(composeFile), composeArgs)
              return
            }

            // DOCKER_HOST mode — local docker CLI, remote daemon
            checkLocalDocker()
            const dockerComposeArgs = ["compose"]
            if (flags.file) dockerComposeArgs.push("-f", flags.file as string)
            dockerComposeArgs.push(...composeArgs)

            try {
              execFileSync("docker", dockerComposeArgs, {
                stdio: "inherit",
                env: buildDockerEnv(target),
              })
            } catch (err: any) {
              if (err.status != null) process.exit(err.status)
              throw err
            }
          })
      )

      // ── dx docker connect <slug> ── subshell mode ──
      .command("connect", (c) =>
        c
          .meta({
            description: "Open a shell connected to a remote Docker daemon",
          })
          .args([
            {
              name: "machine",
              type: "string",
              required: true,
              description: "Machine slug to connect to",
            },
          ])
          .run(async ({ args }) => {
            const slug = args.machine as string
            if (!slug) {
              console.error("Usage: dx docker connect <machine>")
              process.exit(1)
            }

            const target = await resolveMachine(slug)

            console.log(
              styleSuccess(
                `Connected to ${styleBold(target.name)} (${target.kind})`
              )
            )
            console.log(styleMuted(`  DOCKER_HOST=${target.dockerHost}`))
            console.log(
              styleMuted(`  All docker commands in this shell target ${slug}.`)
            )
            console.log(styleMuted(`  Type 'exit' to disconnect.\n`))

            const shell = process.env.SHELL ?? "/bin/zsh"

            try {
              execFileSync(shell, [], {
                stdio: "inherit",
                env: {
                  ...process.env,
                  DOCKER_HOST: target.dockerHost,
                  DX_DOCKER_TARGET: slug,
                },
              })
            } catch (err: any) {
              // Shell exited — this is normal
              if (err.status != null && err.status !== 0) {
                process.exit(err.status)
              }
            }

            console.log(styleMuted(`Disconnected from ${target.name}.`))
          })
      )

      // ── dx docker env <slug> ── print export commands ──
      .command("env", (c) =>
        c
          .meta({
            description: "Print DOCKER_HOST export commands for a machine",
          })
          .args([
            {
              name: "machine",
              type: "string",
              required: true,
              description: "Machine slug",
            },
          ])
          .run(async ({ args }) => {
            const slug = args.machine as string
            if (!slug) {
              console.error("Usage: dx docker env <machine>")
              process.exit(1)
            }

            const target = await resolveMachine(slug)

            // Output to stdout so it can be eval'd
            console.log(`export DOCKER_HOST="${target.dockerHost}"`)
            console.log(`export DX_DOCKER_TARGET="${slug}"`)
            console.error(styleMuted(`# Run: eval $(dx docker env ${slug})`))
            console.error(
              styleMuted(`# Disconnect: unset DOCKER_HOST DX_DOCKER_TARGET`)
            )
          })
      )

      // ── dx docker setup <slug> ── bootstrap Docker ──
      .command("setup", (c) =>
        c
          .meta({
            description:
              "Install Docker and Docker Compose on a remote machine",
          })
          .args([
            {
              name: "machine",
              type: "string",
              required: true,
              description: "Machine slug to set up",
            },
          ])
          .run(async ({ args }) => {
            const slug = args.machine as string
            if (!slug) {
              console.error("Usage: dx docker setup <machine>")
              process.exit(1)
            }

            const target = await resolveMachine(slug)
            console.log(
              `Setting up Docker on ${styleBold(target.name)} (${target.kind}) at ${target.user}@${target.host}...`
            )

            try {
              await runRecipe({
                recipeName: "@dx/docker",
                targets: [target],
                paramEnv: {},
                force: false,
              })
            } catch (err: any) {
              console.error(styleError("\nDocker setup failed."))
              console.log(
                styleMuted(`  Try connecting manually: dx ssh ${slug}`)
              )
              process.exit(err.status ?? 1)
            }

            console.log(styleSuccess(`\nDocker is ready on ${target.name}!`))
            console.log(styleMuted(`  Try: dx docker ps --on ${slug}`))
          })
      )

      // ── dx docker add <slug> --host <ip> ── register a local machine ──
      .command("add", (c) =>
        c
          .meta({
            description: "Register a machine in ~/.config/dx/machines.json",
          })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Machine slug/name",
            },
          ])
          .flags({
            host: {
              type: "string",
              required: true,
              description: "Hostname or IP address",
            },
            user: {
              type: "string",
              short: "u",
              description: "SSH user (default: root)",
            },
            port: {
              type: "number",
              short: "p",
              description: "SSH port (default: 22)",
            },
            tag: {
              type: "string",
              short: "t",
              description: "Tag for machine grouping (repeatable)",
            },
          })
          .run(async ({ args, flags }) => {
            const name = args.name as string
            const host = flags.host as string
            const user = (flags.user as string) ?? "root"
            const port = (flags.port as number) ?? 22
            const rawTag = flags.tag
            const tags = !rawTag
              ? []
              : Array.isArray(rawTag)
                ? rawTag
                : [rawTag]

            if (!name || !host) {
              console.error(
                "Usage: dx docker add <name> --host <ip> [--user <user>] [--port <port>]"
              )
              process.exit(1)
            }

            saveLocalMachine(name, {
              host,
              user,
              port,
              tags: tags.length > 0 ? tags : undefined,
            })

            console.log(styleSuccess(`Machine "${name}" registered.`))
            console.log(styleMuted(`  ${user}@${host}:${port}`))
            console.log(styleMuted(`  Stored in ~/.config/dx/machines.json`))
            console.log(styleMuted(`  Try: dx docker ps --on ${name}`))
          })
      )

      // ── dx docker remove <slug> ── remove a local machine ──
      .command("remove", (c) =>
        c
          .meta({
            description: "Remove a machine from ~/.config/dx/machines.json",
          })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Machine slug/name to remove",
            },
          ])
          .run(async ({ args }) => {
            const name = args.name as string
            if (!name) {
              console.error("Usage: dx docker remove <name>")
              process.exit(1)
            }

            const removed = removeLocalMachine(name)
            if (removed) {
              console.log(styleSuccess(`Machine "${name}" removed.`))
            } else {
              console.error(
                styleError(
                  `Machine "${name}" not found in ~/.config/dx/machines.json.`
                )
              )
              process.exit(1)
            }
          })
      )
  )
}
