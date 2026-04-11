import { existsSync, mkdirSync } from "node:fs"
import { basename, resolve } from "node:path"
import { ExitCodes } from "@smp/factory-shared/exit-codes"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { runInit, type InitOptions } from "../handlers/init/init-handler.js"
import {
  promptProjectName,
  promptInitType,
  promptRuntime,
  promptFramework,
  promptOwner,
} from "../handlers/init/init-prompts.js"
import {
  INIT_TYPES,
  parseLegacyType,
  getFrameworksForTypeAndRuntime,
  type InitType,
  type Runtime,
  type Framework,
} from "../templates/types.js"

setExamples("init", [
  "$ dx init                                                 Create a new project interactively",
  "$ dx init my-platform                                     Create project in ./my-platform/",
  "$ dx init my-api --type service --runtime node             Create a Node.js API service",
  "$ dx init my-lib --type library --runtime python           Create a Python library",
])

const PROJECT_SENTINEL_FILES = [
  "docker-compose.yaml",
  "package.json",
  "pom.xml",
  "pyproject.toml",
]

const VALID_INIT_TYPES = new Set(INIT_TYPES.map((t) => t.value))

export function initCommand(app: DxBase) {
  return app
    .sub("init")
    .meta({
      description: "Scaffold a new project, service, website, or library",
    })
    .args([
      {
        name: "directory",
        type: "string",
        description: "Directory to create the project in",
      },
    ])
    .flags({
      type: {
        type: "string",
        short: "t",
        description:
          "Type: project, service, website, library (or legacy: node-api, java-api, etc.)",
      },
      runtime: {
        type: "string",
        short: "r",
        description: "Runtime (node, java, python)",
      },
      framework: {
        type: "string",
        short: "f",
        description:
          "Framework (elysia, spring-boot, fastapi, react-vinxi, react-tailwind)",
      },
      name: {
        type: "string",
        short: "n",
        description: "Project name",
      },
      owner: {
        type: "string",
        short: "o",
        description: "Owner/team",
      },
      force: {
        type: "boolean",
        description: "Overwrite existing files",
      },
      dir: {
        type: "string",
        short: "C",
        description: "Target directory",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      const cwd = process.cwd()

      try {
        // ── Resolve target directory ────────────────────────────
        let targetDir: string
        if (args.directory) {
          targetDir = resolve(cwd, args.directory)
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true })
          }
        } else if (flags.dir) {
          targetDir = resolve(cwd, flags.dir as string)
        } else {
          targetDir = cwd
        }

        // ── Resolve name ────────────────────────────────────────
        const defaultName =
          basename(targetDir).replace(/[^a-z0-9-]/g, "-") || "my-project"
        let name: string
        if (flags.name) {
          name = (flags.name as string)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
        } else if (args.directory) {
          name = args.directory
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
        } else if (process.stdin.isTTY) {
          name = await promptProjectName(defaultName)
        } else {
          name = defaultName
        }

        // ── Check for existing project files ────────────────────
        const force = Boolean(flags.force)
        if (!force) {
          const existing = PROJECT_SENTINEL_FILES.filter((file) =>
            existsSync(resolve(targetDir, file))
          )
          if (existing.length > 0) {
            exitWithError(
              f,
              `Target directory already contains project files: ${existing.join(", ")}\n` +
                `Use --force to overwrite.`,
              ExitCodes.GENERAL_FAILURE
            )
          }
        }

        // ── Resolve type + runtime + framework ──────────────────
        let initType: InitType | undefined
        let runtime: Runtime | undefined
        let framework: Framework | undefined

        if (flags.type) {
          const typeVal = flags.type as string

          // Check for legacy --type values (e.g. "node-api")
          const legacy = parseLegacyType(typeVal)
          if (legacy) {
            initType = legacy.type as InitType
            runtime = legacy.runtime
            framework = legacy.framework
          } else if (VALID_INIT_TYPES.has(typeVal as InitType)) {
            initType = typeVal as InitType
          } else {
            exitWithError(
              f,
              `Invalid type "${typeVal}". Valid types: ${INIT_TYPES.map((t) => t.value).join(", ")}`,
              ExitCodes.GENERAL_FAILURE
            )
          }
        }

        // Runtime from flag (may override legacy)
        if (flags.runtime) {
          const r = flags.runtime as string
          if (!["node", "java", "python"].includes(r)) {
            exitWithError(
              f,
              `Invalid runtime "${r}". Valid: node, java, python`,
              ExitCodes.GENERAL_FAILURE
            )
          }
          runtime = r as Runtime
        }

        // Framework from flag (may override legacy)
        if (flags.framework) {
          framework = flags.framework as Framework
        }

        // Interactive prompts for missing values
        if (!initType) {
          if (process.stdin.isTTY) {
            initType = await promptInitType()
          } else {
            initType = "project"
          }
        }

        if (initType !== "project") {
          if (!runtime) {
            if (process.stdin.isTTY) {
              runtime = await promptRuntime(initType)
            } else {
              exitWithError(
                f,
                "Runtime is required in non-interactive mode. Use --runtime <node|java|python>.",
                ExitCodes.GENERAL_FAILURE
              )
            }
          }

          if (!framework) {
            if (process.stdin.isTTY) {
              framework = await promptFramework(initType, runtime!)
            } else {
              // Auto-select if only one framework for this type+runtime
              const available = getFrameworksForTypeAndRuntime(
                initType,
                runtime!
              )
              if (available.length === 1) {
                framework = available[0]!.value
              } else {
                exitWithError(
                  f,
                  `Framework is required. Use --framework <${available.map((a) => a.value).join("|")}>`,
                  ExitCodes.GENERAL_FAILURE
                )
              }
            }
          }
        }

        // ── Resolve owner ───────────────────────────────────────
        let owner: string
        if (flags.owner) {
          owner = (flags.owner as string).trim()
        } else if (process.stdin.isTTY) {
          owner = await promptOwner("local")
        } else {
          owner = "local"
        }

        await runInit({
          type: initType!,
          runtime,
          framework,
          name,
          owner,
          targetDir,
          force,
          json: Boolean(f.json),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
