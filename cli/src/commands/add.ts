import { resolve } from "node:path"
import { ExitCodes } from "@smp/factory-shared/exit-codes"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"
import {
  runAdd,
  findProjectRoot,
  type AddOptions,
} from "../handlers/add/add-handler.js"
import {
  promptAddCategory,
  promptResourceName,
  promptComponentType,
  promptRuntime,
  promptFramework,
  promptComponentName,
} from "../handlers/add/add-prompts.js"
import { isResourceName } from "../templates/resource/index.js"
import {
  getFrameworksForTypeAndRuntime,
  type InitType,
  type Runtime,
  type Framework,
} from "../templates/types.js"

setExamples("add", [
  "$ dx add postgres                                         Add PostgreSQL resource",
  "$ dx add redis                                            Add Redis resource",
  "$ dx add my-api --type service --runtime node             Add a Node.js API service",
  "$ dx add my-app --type website --runtime node             Add a React web app",
  "$ dx add --image redis:7-alpine                           Add from Docker image",
  "$ dx add my-cache --image redis:7-alpine                  Add Docker image with custom name",
  "$ dx add --from git@github.com:org/template.git           Add from git repo",
])

export function addCommand(app: DxBase) {
  return app
    .sub("add")
    .meta({
      description:
        "Add a resource, component, Docker image, or git template to a project",
    })
    .args([
      {
        name: "target",
        type: "string",
        description:
          "What to add (resource name like postgres/redis, or component name)",
      },
    ])
    .flags({
      type: {
        type: "string",
        short: "t",
        description: "Component type (service, website, library)",
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
      owner: {
        type: "string",
        short: "o",
        description: "Owner/team",
      },
      image: {
        type: "string",
        short: "i",
        description: "Docker image to add (e.g. redis:7-alpine, postgres:16)",
      },
      from: {
        type: "string",
        description: "Git repo URL to clone template from",
      },
      dir: {
        type: "string",
        short: "C",
        description: "Project root directory",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)

      try {
        // ── Find project root ───────────────────────────────
        const startDir = flags.dir
          ? resolve(flags.dir as string)
          : process.cwd()
        const projectRoot = findProjectRoot(startDir)
        if (!projectRoot) {
          exitWithError(
            f,
            "Not inside a dx project. Run `dx init` first to create a project.",
            ExitCodes.GENERAL_FAILURE
          )
        }

        // ── Image mode ────────────────────────────────────────
        if (flags.image) {
          const result = await runAdd({
            target: args.target as string | undefined,
            image: flags.image as string,
            owner: flags.owner as string | undefined,
            projectRoot: projectRoot!,
            json: Boolean(f.json),
          })

          if (f.json) {
            console.log(JSON.stringify({ success: true, ...result }))
          }
          return
        }

        // ── Git source mode ──────────────────────────────────
        if (flags.from) {
          const result = await runAdd({
            target: args.target as string | undefined,
            from: flags.from as string,
            owner: flags.owner as string | undefined,
            projectRoot: projectRoot!,
            json: Boolean(f.json),
          })

          if (f.json) {
            console.log(JSON.stringify({ success: true, ...result }))
          }
          return
        }

        let target = args.target as string | undefined
        let type = flags.type as Exclude<InitType, "project"> | undefined
        let runtime = flags.runtime as Runtime | undefined
        let framework = flags.framework as Framework | undefined

        // ── Resolve what to add ─────────────────────────────
        if (target && isResourceName(target) && !type) {
          // Resource mode — target is a known resource name
          // Fall through to runAdd with just the target
        } else if (type) {
          // Component mode — validate type
          if (type === ("project" as string)) {
            exitWithError(
              f,
              "Cannot add a project to an existing project.",
              ExitCodes.GENERAL_FAILURE
            )
          }
          if (!["service", "website", "library"].includes(type)) {
            exitWithError(
              f,
              `Invalid type "${type}". Valid types: service, website, library`,
              ExitCodes.GENERAL_FAILURE
            )
          }

          // Validate runtime
          if (runtime && !["node", "java", "python"].includes(runtime)) {
            exitWithError(
              f,
              `Invalid runtime "${runtime}". Valid: node, java, python`,
              ExitCodes.GENERAL_FAILURE
            )
          }

          // Resolve runtime
          if (!runtime) {
            if (process.stdin.isTTY) {
              runtime = await promptRuntime(type)
            } else {
              exitWithError(
                f,
                "Runtime is required in non-interactive mode. Use --runtime <node|java|python>.",
                ExitCodes.GENERAL_FAILURE
              )
            }
          }

          // Resolve framework
          if (!framework) {
            const available = getFrameworksForTypeAndRuntime(type, runtime!)
            if (available.length === 1) {
              framework = available[0]!.value
            } else if (process.stdin.isTTY) {
              framework = await promptFramework(type, runtime!)
            } else {
              exitWithError(
                f,
                `Framework is required. Use --framework <${available.map((a) => a.value).join("|")}>`,
                ExitCodes.GENERAL_FAILURE
              )
            }
          }

          // Resolve name
          if (!target) {
            if (process.stdin.isTTY) {
              target = await promptComponentName()
            } else {
              exitWithError(
                f,
                "Component name is required.",
                ExitCodes.GENERAL_FAILURE
              )
            }
          }
        } else if (!target) {
          // Fully interactive mode
          if (!process.stdin.isTTY) {
            exitWithError(
              f,
              "Provide a resource name or --type in non-interactive mode.",
              ExitCodes.GENERAL_FAILURE
            )
          }

          const category = await promptAddCategory()

          if (category === "resource") {
            target = await promptResourceName()
          } else {
            type = await promptComponentType()
            runtime = await promptRuntime(type)
            framework = await promptFramework(type, runtime)
            target = await promptComponentName()
          }
        } else {
          // Target provided but it's not a known resource and no --type
          // Treat it as a component name and prompt for type
          if (process.stdin.isTTY) {
            type = await promptComponentType()
            runtime = await promptRuntime(type)
            framework = await promptFramework(type, runtime)
          } else {
            exitWithError(
              f,
              `"${target}" is not a known resource. Use --type to add a component.`,
              ExitCodes.GENERAL_FAILURE
            )
          }
        }

        const result = await runAdd({
          target,
          type,
          runtime,
          framework,
          owner: flags.owner as string | undefined,
          projectRoot: projectRoot!,
          json: Boolean(f.json),
        })

        if (f.json) {
          console.log(
            JSON.stringify({
              success: true,
              ...result,
            })
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
