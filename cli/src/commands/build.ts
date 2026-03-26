import { join, resolve } from "node:path";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { dockerBuild } from "../lib/docker.js";
import { ProjectContext } from "../lib/project.js";

import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("build", [
  "$ dx build               Build all components",
  "$ dx build api           Build specific component",
]);

function imageTag(module: string, component: string): string {
  const safe = `${module}-${component}`.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  return `${safe}:latest`;
}

export function buildCommand(app: DxBase) {
  return app
    .sub("build")
    .meta({ description: "Build artifacts" })
    .args([
      {
        name: "components",
        type: "string",
        variadic: true,
        description: "Component names to build (default: all in dx.yaml)",
      },
    ])
    .run(({ args, flags }) => {
      const f = toDxFlags(flags);
      try {
        const project = ProjectContext.fromCwd();
        const mod = project.moduleConfig.module;
        const names =
          args.components?.length && args.components.length > 0
            ? args.components
            : Object.keys(project.moduleConfig.components);
        for (const name of names) {
          const ref = project.moduleConfig.components[name];
          if (!ref) {
            exitWithError(f, `Unknown component "${name}" in dx.yaml`);
          }
          const compCfg = project.componentConfigs[name] ?? {};
          const dockerfileName = compCfg.build?.dockerfile ?? "Dockerfile";
          const relCtx = compCfg.build?.context ?? ".";
          const compRoot = resolve(project.rootDir, ref.path);
          const context = resolve(compRoot, relCtx);
          const dockerfilePath = join(context, dockerfileName);
          const tag = imageTag(mod, name);
          if (f.verbose) {
            console.log(`docker build -t ${tag} -f ${dockerfilePath} ${context}`);
          }
          dockerBuild(context, dockerfilePath, tag);
          if (!f.json) {
            console.log(`Built ${tag}`);
          }
        }
        if (f.json) {
          console.log(JSON.stringify({ success: true, exitCode: 0 }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
