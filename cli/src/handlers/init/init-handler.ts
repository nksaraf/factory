import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { generateProject, generateStandalone } from "../../templates/index.js";
import {
  resolveTemplateKey,
  type InitType,
  type Runtime,
  type Framework,
  type TemplateVars,
  type GeneratedFile,
} from "../../templates/types.js";
import { styleSuccess, styleMuted } from "../../cli-style.js";

export interface InitOptions {
  type: InitType;
  runtime?: Runtime;
  framework?: Framework;
  name: string;
  owner: string;
  targetDir: string;
  force: boolean;
  json: boolean;
}

function installCommand(type: InitType, runtime?: Runtime): string {
  if (type === "project") return "pnpm install";
  if (!runtime) return "pnpm install";
  if (runtime === "java") return "mvn install";
  if (runtime === "python") return "uv sync";
  return "pnpm install";
}

export async function runInit(opts: InitOptions): Promise<void> {
  const { type, runtime, framework, name, owner, targetDir, force, json } = opts;

  const vars: TemplateVars = { name, owner, description: "" };
  let files: GeneratedFile[];

  if (type === "project") {
    files = generateProject(vars);
  } else {
    const templateKey = resolveTemplateKey({
      type,
      runtime: runtime!,
      framework: framework!,
    });
    files = generateStandalone(templateKey, vars);
  }

  // ── Write all files ──────────────────────────────────────────
  for (const file of files) {
    const fullPath = join(targetDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf8");

    // Make hook scripts executable
    if (file.path.startsWith(".dx/hooks/")) {
      chmodSync(fullPath, 0o755);
    }
  }

  const filePaths = files.map((f) => f.path);

  // ── Post-scaffold: git init + hooks ──────────────────────────
  const gitDir = join(targetDir, ".git");
  if (!existsSync(gitDir)) {
    const gitInit = spawnSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });
    if (gitInit.status === 0) {
      // Set hooks path to use our .dx/hooks
      spawnSync("git", ["config", "core.hooksPath", ".dx/hooks"], { cwd: targetDir, stdio: "ignore" });

      // Initial commit
      spawnSync("git", ["add", "-A"], { cwd: targetDir, stdio: "ignore" });
      spawnSync("git", ["commit", "-m", "feat: scaffold project"], { cwd: targetDir, stdio: "ignore" });
    }
  }

  // ── Output ───────────────────────────────────────────────────
  if (json) {
    console.log(
      JSON.stringify({
        success: true,
        path: targetDir,
        name,
        type,
        ...(runtime ? { runtime } : {}),
        ...(framework ? { framework } : {}),
        owner,
        files: filePaths,
      }),
    );
    return;
  }

  console.log(
    styleSuccess(`\u2714 Created ${type} "${name}" with ${files.length} files`),
  );
  console.log();

  if (type === "project") {
    console.log(`  apps/${name}-app/        Vinxi + React frontend`);
    console.log(`  services/${name}-api/    Elysia + Drizzle API`);
    console.log(`  compose/                PostgreSQL, Auth, Gateway`);
    console.log(`  .dx/hooks/              Git hooks (conventional commits, lint-staged, quality checks)`);
    console.log(`  .github/workflows/      CI pipeline (dx check → deploy)`);
  } else {
    const rel = relative(process.cwd(), targetDir) || ".";
    console.log(`  Created ${type} in ${rel}`);
  }

  console.log();
  console.log(styleMuted("Next steps:"));
  console.log(styleMuted(`  cd ${name}`));
  console.log(styleMuted(`  ${installCommand(type, runtime)}`));
  console.log(styleMuted(`  dx dev`));
}
