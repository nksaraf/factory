import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { ExitCodes } from "@smp/factory-shared/exit-codes";
import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";
import { runInit, type InitOptions } from "../handlers/init/init-handler.js";
import {
  promptProjectName,
  promptInitMode,
  promptStandaloneType,
  promptOwner,
} from "../handlers/init/init-prompts.js";
import { STANDALONE_TYPES, type StandaloneType } from "../templates/types.js";

setExamples("init", [
  "$ dx init                              Create a new factory project interactively",
  "$ dx init my-platform                  Create project in ./my-platform/",
  "$ dx init --standalone --type node-api Create a standalone Node.js API",
  "$ dx init --standalone --type python-lib --name my-utils",
]);

const PROJECT_SENTINEL_FILES = [
  "docker-compose.yaml",
  "package.json",
  "pom.xml",
  "pyproject.toml",
];

export function initCommand(app: DxBase) {
  return app
    .sub("init")
    .meta({
      description:
        "Scaffold a new project or standalone service/library",
    })
    .args([
      {
        name: "directory",
        type: "string",
        description: "Directory to create the project in",
      },
    ])
    .flags({
      standalone: {
        type: "boolean",
        short: "s",
        description: "Create a standalone service, app, or library",
      },
      type: {
        type: "string",
        short: "t",
        description: "Standalone type (e.g. node-api, java-lib, python-api)",
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
        short: "f",
        description: "Overwrite existing files",
      },
      dir: {
        type: "string",
        short: "C",
        description: "Target directory",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const cwd = process.cwd();

      try {
        // Resolve target directory
        let targetDir: string;
        if (args.directory) {
          targetDir = resolve(cwd, args.directory);
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
          }
        } else if (flags.dir) {
          targetDir = resolve(cwd, flags.dir as string);
        } else {
          targetDir = cwd;
        }

        // Resolve name
        const defaultName =
          basename(targetDir).replace(/[^a-z0-9-]/g, "-") || "my-project";
        let name: string;
        if (flags.name) {
          name = (flags.name as string).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
        } else if (args.directory) {
          name = args.directory.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
        } else if (process.stdin.isTTY) {
          name = await promptProjectName(defaultName);
        } else {
          name = defaultName;
        }

        // Check for existing project files
        const force = Boolean(flags.force);
        if (!force) {
          const existing = PROJECT_SENTINEL_FILES.filter((file) =>
            existsSync(resolve(targetDir, file)),
          );
          if (existing.length > 0) {
            exitWithError(
              f,
              `Target directory already contains project files: ${existing.join(", ")}\n` +
                `Use --force to overwrite.`,
              ExitCodes.GENERAL_FAILURE,
            );
          }
        }

        // Resolve mode
        let mode: InitOptions["mode"];
        if (flags.standalone || flags.type) {
          mode = "standalone";
        } else if (process.stdin.isTTY) {
          mode = await promptInitMode();
        } else {
          exitWithError(
            f,
            "Cannot determine mode in non-interactive mode. Use --standalone or omit for project mode.",
            ExitCodes.GENERAL_FAILURE,
          );
        }

        // Resolve standalone type
        let standaloneType: StandaloneType | undefined;
        if (mode === "standalone") {
          if (flags.type) {
            const typeVal = flags.type as string;
            const valid = STANDALONE_TYPES.find((t) => t.value === typeVal);
            if (!valid) {
              exitWithError(
                f,
                `Invalid standalone type "${typeVal}". Valid types: ${STANDALONE_TYPES.map((t) => t.value).join(", ")}`,
                ExitCodes.GENERAL_FAILURE,
              );
            }
            standaloneType = typeVal as StandaloneType;
          } else if (process.stdin.isTTY) {
            standaloneType = await promptStandaloneType();
          } else {
            exitWithError(
              f,
              "Standalone type is required in non-interactive mode. Use --type <type>.",
              ExitCodes.GENERAL_FAILURE,
            );
          }
        }

        // Resolve owner
        let owner: string;
        if (flags.owner) {
          owner = (flags.owner as string).trim();
        } else if (process.stdin.isTTY) {
          owner = await promptOwner("local");
        } else {
          owner = "local";
        }

        await runInit({
          mode,
          type: standaloneType,
          name,
          owner,
          targetDir,
          force,
          json: Boolean(f.json),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
