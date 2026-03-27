import { basename } from "node:path";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { composeUp, isDockerRunning } from "../lib/docker.js";
import { ProjectContext } from "../lib/project.js";

import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("up", [
  "$ dx up                  Bring up all services",
  "$ dx up infra            Bring up a profile",
  "$ dx up postgres redis   Bring up specific services",
  "$ dx up --no-build       Skip building local services",
]);

export function upCommand(app: DxBase) {
  return app
    .sub("up")
    .meta({ description: "Bring up the docker compose stack" })
    .args([
      {
        name: "targets",
        type: "string",
        variadic: true,
        description: "Profile names or service names to bring up",
      },
    ])
    .flags({
      build: {
        type: "boolean",
        description: "Build local services (default: true, use --no-build to skip)",
      },
      detach: {
        type: "boolean",
        description: "Run in detached mode (default: true)",
      },
    })
    .run(({ args, flags }) => {
      const f = toDxFlags(flags);
      try {
        if (!isDockerRunning()) {
          exitWithError(f, "Docker does not appear to be running.");
        }

        const project = ProjectContext.fromCwd();
        if (project.composeFiles.length === 0) {
          exitWithError(f, "No docker-compose files found.");
        }

        const knownProfiles = new Set(project.allProfiles);
        const targets = args.targets ?? [];

        // Separate targets into profiles and service names
        const profiles: string[] = [];
        const services: string[] = [];

        if (targets.length === 0) {
          // No targets → activate all known profiles
          profiles.push(...knownProfiles);
        } else {
          for (const target of targets) {
            if (knownProfiles.has(target)) {
              profiles.push(target);
            } else {
              services.push(target);
            }
          }
        }

        if (f.verbose) {
          if (profiles.length > 0) {
            console.log(`Profiles: ${profiles.join(", ")}`);
          }
          if (services.length > 0) {
            console.log(`Services: ${services.join(", ")}`);
          }
          console.log(`Compose files: ${project.composeFiles.join(", ")}`);
        }

        composeUp(project.composeFiles, {
          detach: flags.detach !== false,
          noBuild: flags.build === false,
          projectName: basename(project.rootDir),
          profiles: profiles.length > 0 ? profiles : undefined,
          services: services.length > 0 ? services : undefined,
        });

        if (!f.json) {
          const parts: string[] = [];
          if (profiles.length > 0) parts.push(`profiles: ${profiles.join(", ")}`);
          if (services.length > 0) parts.push(`services: ${services.join(", ")}`);
          const detail = parts.length > 0 ? ` (${parts.join("; ")})` : "";
          console.log(`Stack started${detail}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
