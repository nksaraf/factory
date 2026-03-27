import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { generateProject, generateStandalone } from "../../templates/index.js";
import type { InitMode, StandaloneType, TemplateVars, GeneratedFile } from "../../templates/types.js";
import { styleSuccess, styleMuted } from "../../cli-style.js";

export interface InitOptions {
  mode: InitMode;
  type?: StandaloneType;
  name: string;
  owner: string;
  targetDir: string;
  force: boolean;
  json: boolean;
}

function installCommand(mode: InitMode, type?: StandaloneType): string {
  if (mode === "project") return "pnpm install";
  if (!type) return "pnpm install";
  if (type.startsWith("java")) return "mvn install";
  if (type.startsWith("python")) return "uv sync";
  return "pnpm install";
}

export async function runInit(opts: InitOptions): Promise<void> {
  const { mode, type, name, owner, targetDir, force, json } = opts;

  const vars: TemplateVars = { name, owner, description: "" };
  const files: GeneratedFile[] =
    mode === "project"
      ? generateProject(vars)
      : generateStandalone(type!, vars);

  for (const file of files) {
    const fullPath = join(targetDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf8");
  }

  const filePaths = files.map((f) => f.path);

  if (json) {
    console.log(
      JSON.stringify({
        success: true,
        path: targetDir,
        name,
        mode,
        ...(type ? { type } : {}),
        owner,
        files: filePaths,
      }),
    );
    return;
  }

  console.log(
    styleSuccess(`\u2714 Created ${mode} "${name}" with ${files.length} files`),
  );
  console.log();

  if (mode === "project") {
    console.log(`  apps/${name}-app/        Vinxi + React frontend`);
    console.log(`  services/${name}-api/    Elysia + Drizzle API`);
    console.log(`  compose/                PostgreSQL, Auth, Gateway`);
  } else {
    const rel = relative(process.cwd(), targetDir) || ".";
    console.log(`  Created ${type} project in ${rel}`);
  }

  console.log();
  console.log(styleMuted("Next steps:"));
  console.log(styleMuted(`  cd ${name}`));
  console.log(styleMuted(`  ${installCommand(mode, type)}`));
  console.log(styleMuted(`  dx dev`));
}
