import { execFileSync, execSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { getFactoryClient } from "../client.js"
import type { DxBase } from "../dx-root.js"
import { EntityFinder } from "../lib/entity-finder.js"
import type { ResolvedEntity } from "../lib/entity-finder.js"
import {
  buildKubectlExecArgs,
  buildSshArgs,
  clearStaleHostKey,
  formatJumpSpec,
  generateSshConfigBlocks,
  mergeSshConfig,
} from "../lib/ssh-utils.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  type ColumnOpt,
  actionResult,
  apiCall,
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
  styleWarn,
  tableOrJson,
} from "./list-helpers.js"

setExamples("ssh", [
  "$ dx ssh my-workbench              SSH into a machine by name",
  "$ dx ssh config sync               Generate ~/.ssh/config entries",
  "$ dx ssh keys list                 List registered SSH keys",
  "$ dx ssh keys add                  Register your SSH public key",
  "$ dx ssh keys revoke <id>          Revoke an SSH key",
])

async function getApi() {
  return getFactoryClient()
}
const A = (api: any) => api.api.v1.factory.infra

export function sshCommand(app: DxBase) {
  return (
    app
      .sub("ssh")
      .meta({ description: "SSH access and key management" })

      // --- dx ssh <name> : connect by name ---
      .args([
        {
          name: "target",
          type: "string",
          description: "Machine name/slug to SSH into",
        },
      ])
      .flags({
        user: {
          type: "string",
          short: "l",
          description: "Override SSH user",
        },
        port: {
          type: "number",
          short: "p",
          description: "Override SSH port",
        },
        identity: {
          type: "string",
          short: "i",
          description: "Path to identity file (private key)",
        },
      })
      .run(async ({ args, flags }) => {
        const target = args.target
        if (!target) {
          // Try interactive picker
          try {
            const { filter } = await import("@crustjs/prompts")
            const finder = new EntityFinder()
            const entities = await finder.list()

            if (entities.length === 0) {
              console.log(styleMuted("No SSH targets found."))
              process.exit(1)
            }

            const chosen = await filter({
              message: "Select a machine to SSH into",
              choices: entities.map((e) => ({
                label: `${e.slug.padEnd(24)} ${styleMuted(e.type.padEnd(10))} ${styleMuted(e.status)}`,
                value: e,
              })),
            })

            return connectToEntity(chosen, flags)
          } catch (err: any) {
            // If inquirer not available or user cancelled
            console.error("Usage: dx ssh <name>")
            console.log(
              styleMuted(
                "\nResolves a machine by name and opens an SSH session."
              )
            )
            console.log(styleMuted("Searches workbenches and hosts by slug.\n"))
            console.log("  dx ssh my-workbench")
            console.log("  dx ssh build-host-3")
            console.log("  dx ssh dev-vm --user ubuntu")
            process.exit(1)
          }
        }

        const finder = new EntityFinder()
        const entity = await finder.resolve(target)

        if (!entity) {
          console.error(styleError(`No SSH target found for "${target}".`))
          console.log(styleMuted("\nSearched workbenches and hosts. Try:"))
          console.log(
            styleMuted("  dx ssh config sync   — see all available targets")
          )
          process.exit(1)
        }

        // Capture remote command from args after "--"
        const ddIdx = process.argv.indexOf("--")
        const remoteCmd = ddIdx >= 0 ? process.argv.slice(ddIdx + 1) : []

        return connectToEntity(entity, flags, remoteCmd)
      })

      // --- dx ssh config sync ---
      .command("config", (c) =>
        c.meta({ description: "Manage SSH config" }).command("sync", (sc) =>
          sc
            .meta({
              description:
                "Generate ~/.ssh/config entries for all accessible machines",
            })
            .flags({
              "dry-run": {
                type: "boolean",
                description: "Print config to stdout instead of writing",
              },
              file: {
                type: "string",
                description: "SSH config file path (default: ~/.ssh/config)",
              },
            })
            .run(async ({ flags }) => {
              const api = await getApi()
              const result = await A(api).access.targets.get({
                query: { limit: "200" },
              })
              const raw: any[] = result?.data?.data ?? []
              const targets = raw.filter((t: any) => t.host)

              if (raw.length > 0 && targets.length < raw.length) {
                console.log(
                  styleWarn(
                    `${raw.length - targets.length} target(s) skipped (missing host/IP).`
                  )
                )
              }

              if (targets.length === 0) {
                console.log(styleMuted("No SSH targets found."))
                return
              }

              const blocks = generateSshConfigBlocks(targets)
              const configContent = blocks.join("\n")

              if (flags["dry-run"]) {
                console.log(configContent)
                return
              }

              const configPath =
                (flags.file as string) ?? join(homedir(), ".ssh", "config")
              mergeSshConfig(configPath, configContent)
              console.log(
                styleSuccess(
                  `Updated ${configPath} with ${targets.length} targets:`
                )
              )
              for (const t of targets) {
                console.log(
                  `  ${styleBold(t.slug.padEnd(24))} ${styleMuted(`${t.kind}  ${t.user}@${t.host}:${t.port}`)}`
                )
              }
            })
        )
      )

      // --- dx ssh keys ---
      .command("keys", (c) =>
        c
          .meta({ description: "Manage SSH keys" })

          // --- keys list ---
          .command("list", (sc) =>
            sc
              .meta({ description: "List registered SSH keys" })
              .flags({
                "principal-id": {
                  type: "string",
                  description: "Filter by principal ID",
                },
              })
              .run(async ({ flags }) => {
                const api = await getApi()
                const query: Record<string, string> = {}
                if (flags["principal-id"])
                  query.principalId = flags["principal-id"] as string
                const result = await apiCall(flags, () =>
                  A(api).secrets.get({ query: { ...query, type: "ssh-key" } })
                )
                tableOrJson(
                  flags,
                  result,
                  ["ID", "Name", "Type", "Fingerprint", "Status", "Created"],
                  (r) => [
                    styleMuted(String(r.sshKeyId ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.keyType ?? ""),
                    styleMuted(String(r.fingerprint ?? "").slice(0, 47)),
                    r.status === "active"
                      ? styleSuccess("active")
                      : styleWarn(String(r.status ?? "")),
                    r.createdAt
                      ? new Date(r.createdAt as string).toLocaleDateString()
                      : "",
                  ],
                  undefined,
                  { emptyMessage: "No SSH keys registered." }
                )
              })
          )

          // --- keys add ---
          .command("add", (sc) =>
            sc
              .meta({ description: "Register an SSH public key" })
              .flags({
                name: {
                  type: "string",
                  required: true,
                  description: "Key name (e.g. 'laptop', 'workstation')",
                },
                file: {
                  type: "string",
                  description:
                    "Path to public key file (default: ~/.ssh/id_ed25519.pub)",
                },
                "principal-id": {
                  type: "string",
                  description: "Principal ID (auto-detected if omitted)",
                },
              })
              .run(async ({ flags }) => {
                const keyPath = (flags.file as string) ?? findDefaultPubKey()
                if (!keyPath || !existsSync(keyPath)) {
                  console.error(
                    styleError(
                      `Public key not found: ${keyPath ?? "~/.ssh/id_ed25519.pub"}`
                    )
                  )
                  console.log(
                    styleMuted("\nGenerate one with:  ssh-keygen -t ed25519")
                  )
                  process.exit(1)
                }

                const pubKey = readFileSync(keyPath, "utf-8").trim()
                const keyType = detectKeyType(pubKey)
                const fingerprint = computeFingerprint(keyPath)
                const principalId =
                  (flags["principal-id"] as string) ?? detectPrincipalId()

                const api = await getApi()
                const result = await A(api).secrets.post({
                  name: flags.name as string,
                  spec: {
                    type: "ssh-key",
                    principalId,
                    publicKey: pubKey,
                    fingerprint,
                    keyType,
                  },
                })

                if (result?.data?.success) {
                  console.log(
                    styleSuccess(`SSH key "${flags.name}" registered.`)
                  )
                  console.log(styleMuted(`  Fingerprint: ${fingerprint}`))
                  console.log(styleMuted(`  Type: ${keyType}`))
                } else {
                  console.error(styleError("Failed to register key."))
                  if (result?.data) console.error(result.data)
                  process.exit(1)
                }
              })
          )

          // --- keys revoke ---
          .command("revoke", (sc) =>
            sc
              .meta({ description: "Revoke an SSH key" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "SSH key ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getApi()
                const result = await apiCall(flags, () =>
                  A(api).secrets({ slugOrId: args.id }).revoke.post()
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`SSH key ${args.id} revoked.`)
                )
              })
          )

          // --- keys remove ---
          .command("remove", (sc) =>
            sc
              .meta({ description: "Remove an SSH key" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "SSH key ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getApi()
                const result = await apiCall(flags, () =>
                  A(api).secrets({ slugOrId: args.id }).delete.post()
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`SSH key ${args.id} removed.`)
                )
              })
          )

          // --- keys init ---
          .command("init", (sc) =>
            sc
              .meta({ description: "Generate an SSH keypair and register it" })
              .flags({
                name: {
                  type: "string",
                  description: "Key name (default: hostname)",
                },
                type: {
                  type: "string",
                  description: "Key type: ed25519 (default), rsa, ecdsa",
                },
                "principal-id": {
                  type: "string",
                  description: "Principal ID (auto-detected if omitted)",
                },
              })
              .run(async ({ flags }) => {
                const keyType = (flags.type as string) ?? "ed25519"
                const keyPath = join(homedir(), ".ssh", `id_${keyType}`)
                const pubPath = `${keyPath}.pub`

                if (existsSync(keyPath)) {
                  console.log(styleMuted(`Key already exists: ${keyPath}`))
                } else {
                  console.log(`Generating ${keyType} keypair...`)
                  mkdirSync(join(homedir(), ".ssh"), {
                    recursive: true,
                    mode: 0o700,
                  })
                  execFileSync(
                    "ssh-keygen",
                    [
                      "-t",
                      keyType,
                      "-f",
                      keyPath,
                      "-N",
                      "",
                      "-C",
                      `dx-managed`,
                    ],
                    { stdio: "inherit" }
                  )
                }

                if (!existsSync(pubPath)) {
                  console.error(
                    styleError(`Public key not found at ${pubPath}`)
                  )
                  process.exit(1)
                }

                const pubKey = readFileSync(pubPath, "utf-8").trim()
                const fingerprint = computeFingerprint(pubPath)
                const keyName = (flags.name as string) ?? getHostname()
                const principalId =
                  (flags["principal-id"] as string) ?? detectPrincipalId()

                const api = await getApi()
                try {
                  const result = await A(api).secrets.post({
                    name: keyName,
                    spec: {
                      type: "ssh-key",
                      principalId,
                      publicKey: pubKey,
                      fingerprint,
                      keyType,
                    },
                  })

                  if (result?.data?.success) {
                    console.log(
                      styleSuccess(`Key "${keyName}" generated and registered.`)
                    )
                    console.log(styleMuted(`  Private key: ${keyPath}`))
                    console.log(styleMuted(`  Public key:  ${pubPath}`))
                    console.log(styleMuted(`  Fingerprint: ${fingerprint}`))
                  } else {
                    console.log(
                      styleMuted(
                        "Key generated locally. Registration failed — you can retry with: dx ssh keys add"
                      )
                    )
                  }
                } catch {
                  console.log(
                    styleMuted(
                      "Key generated locally. Could not reach Factory API to register."
                    )
                  )
                  console.log(
                    styleMuted("Register later with: dx ssh keys add")
                  )
                }
              })
          )
      )
  )
}

// ─── Connect Helper ──────────────────────────────────────────

export async function connectToEntity(
  entity: ResolvedEntity,
  flags: Record<string, unknown>,
  remoteCmd: string[] = []
) {
  const hasCommand = remoteCmd.length > 0

  if (entity.transport === "kubectl") {
    if (!hasCommand) {
      console.log(
        styleMuted(
          `Connecting to ${styleBold(entity.displayName)} (${entity.type}) via kubectl exec`
        )
      )
    }

    const kubectlArgs = buildKubectlExecArgs({
      podName: entity.podName!,
      namespace: entity.namespace!,
      container: entity.container,
      kubeContext: flags.context as string,
      interactive: !hasCommand,
    })

    if (hasCommand) {
      kubectlArgs.push("--", "/bin/sh", "-c", remoteCmd.join(" "))
    } else {
      kubectlArgs.push("--", "/bin/bash")
    }

    // If we have an inline kubeconfig from the factory, write it to a temp file.
    // The stored kubeconfig may use host.docker.internal (for the compose container's
    // reconciler). Rewrite back to localhost since the CLI runs on the host.
    let kubeconfigTmp: string | undefined
    if (entity.kubeconfig) {
      const hostKubeconfig = entity.kubeconfig.replace(
        /server:\s*https?:\/\/host\.docker\.internal/g,
        (match) => match.replace("host.docker.internal", "localhost")
      )
      kubeconfigTmp = join(tmpdir(), `dx-kubeconfig-${Date.now()}.yaml`)
      writeFileSync(kubeconfigTmp, hostKubeconfig, { mode: 0o600 })
      kubectlArgs.unshift("--kubeconfig", kubeconfigTmp)
    }

    try {
      execFileSync("kubectl", kubectlArgs, { stdio: "inherit" })
    } catch (err: any) {
      if (err.status != null) process.exit(err.status)
      throw err
    } finally {
      if (kubeconfigTmp)
        try {
          unlinkSync(kubeconfigTmp)
        } catch {}
    }
    return
  }

  // SSH transport
  const host = entity.sshHost!
  const port = (flags.port as number) ?? entity.sshPort ?? 22
  const user = (flags.user as string) ?? entity.sshUser ?? "root"

  // Clear stale host keys for interactive sessions
  clearStaleHostKey(host, port)

  if (!hasCommand) {
    console.log(
      styleMuted(
        `Connecting to ${styleBold(entity.displayName)} (${entity.type}) → ${user}@${host}:${port}`
      )
    )
  }

  const sshArgs = buildSshArgs({
    host,
    port,
    user,
    identity: (flags.identity as string) ?? entity.identityFile,
    tty: hasCommand ? "none" : "force",
    hostKeyCheck: "accept-new",
    jumpHost: entity.jumpHost,
    jumpUser: entity.jumpUser,
    jumpPort: entity.jumpPort,
  })

  if (hasCommand) {
    sshArgs.push(remoteCmd.join(" "))
  }

  try {
    execFileSync("ssh", sshArgs, { stdio: "inherit" })
  } catch (err: any) {
    if (err.status != null) process.exit(err.status)
    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function findDefaultPubKey(): string | null {
  const sshDir = join(homedir(), ".ssh")
  for (const name of ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"]) {
    const p = join(sshDir, name)
    if (existsSync(p)) return p
  }
  return join(sshDir, "id_ed25519.pub")
}

function detectKeyType(pubKey: string): string {
  if (pubKey.startsWith("ssh-ed25519")) return "ed25519"
  if (pubKey.startsWith("ssh-rsa")) return "rsa"
  if (pubKey.startsWith("ecdsa-")) return "ecdsa"
  return "ed25519"
}

function computeFingerprint(pubKeyPath: string): string {
  try {
    const output = execFileSync("ssh-keygen", ["-lf", pubKeyPath], {
      encoding: "utf-8",
    }).trim()
    // Output: "256 SHA256:abc123... comment (ED25519)"
    const parts = output.split(" ")
    return parts[1] ?? output
  } catch {
    return "unknown"
  }
}

function detectPrincipalId(): string {
  const { userInfo } = require("node:os")
  return `local:${userInfo().username}`
}

function getHostname(): string {
  const { hostname } = require("node:os")
  return hostname()
}
