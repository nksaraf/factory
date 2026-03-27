import { basename } from "node:path";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { composeDown, isDockerRunning } from "../lib/docker.js";
import { ProjectContext } from "../lib/project.js";

import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("down", [
  "$ dx down                Tear down all services",
  "$ dx down --volumes      Also remove volumes",
]);

export function downCommand(app: DxBase) {
  return app
    .sub("down")
    .meta({ description: "Tear down the docker compose stack" })
    .flags({
      volumes: {
        type: "boolean",
        alias: "v",
        description: "Remove named volumes declared in the compose file",
      },
    })
    .run(({ flags }) => {
      const f = toDxFlags(flags);
      try {
        if (!isDockerRunning()) {
          exitWithError(f, "Docker does not appear to be running.");
        }

        const project = ProjectContext.fromCwd();
        if (project.composeFiles.length === 0) {
          exitWithError(f, "No docker-compose files found.");
        }

        const allProfiles = [...new Set(project.allProfiles)];

        if (f.verbose) {
          if (allProfiles.length > 0) {
            console.log(`Profiles: ${allProfiles.join(", ")}`);
          }
          console.log(`Compose files: ${project.composeFiles.join(", ")}`);
        }

        composeDown(project.composeFiles, {
          projectName: basename(project.rootDir),
          profiles: allProfiles.length > 0 ? allProfiles : undefined,
          volumes: flags.volumes as boolean | undefined ? true : false,
        });

        if (!f.json) {
          const volMsg = flags.volumes ? " (volumes removed)" : "";
          console.log(`Stack stopped${volMsg}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
