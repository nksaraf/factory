import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  resolveTemplateKey,
  type InitType,
  type Runtime,
  type Framework,
  type TemplateVars,
  type GeneratedFile,
} from "../../templates/types.js";
import { generateStandalone } from "../../templates/index.js";
import {
  generateResource,
  isResourceName,
  type ResourceName,
} from "../../templates/resource/index.js";
import { componentLabels, labelsToYaml } from "../../templates/compose-labels.js";
import { styleSuccess, styleMuted } from "../../cli-style.js";
import { isDockerRunning } from "../../lib/docker.js";
import { inspectImage, imageToName } from "../../lib/docker-inspect.js";
import { generateComposeFromImage } from "./image-to-compose.js";
import { cloneAndExtract } from "./git-source.js";

// ─── Types ──────────────────────────────────────────────────

export interface AddOptions {
  target?: string;
  type?: Exclude<InitType, "project">;
  runtime?: Runtime;
  framework?: Framework;
  image?: string;
  from?: string;
  owner?: string;
  projectRoot: string;
  json: boolean;
}

interface AddResult {
  category: "resource" | "component" | "image" | "git";
  name: string;
  files: string[];
}

// ─── Project root detection ─────────────────────────────────

/**
 * Find the project root by walking up from `start` looking for a
 * docker-compose.yaml that uses `include:`.
 */
export function findProjectRoot(start: string): string | undefined {
  let dir = resolve(start);
  const root = resolve("/");
  while (dir !== root) {
    const composePath = join(dir, "docker-compose.yaml");
    if (existsSync(composePath)) {
      const content = readFileSync(composePath, "utf8");
      if (content.includes("include:")) return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

// ─── Compose file update ────────────────────────────────────

/**
 * Insert a new include entry into docker-compose.yaml under the right section.
 * Sections are identified by comments: `# Resources` (or `# Infrastructure`), `# Services`, `# Apps`.
 */
function updateComposeIncludes(
  projectRoot: string,
  composePath: string,
  section: "resources" | "services" | "apps",
): void {
  const fullPath = join(projectRoot, "docker-compose.yaml");
  const content = readFileSync(fullPath, "utf8");
  const lines = content.split("\n");

  const newEntry = `  - path: ${composePath}`;

  // Map section to comment patterns
  const sectionComments: Record<string, string[]> = {
    resources: ["# Resources", "# Infrastructure"],
    services: ["# Services"],
    apps: ["# Apps"],
  };

  // Section order for insertion
  const sectionOrder = ["resources", "services", "apps"];
  const targetPatterns = sectionComments[section]!;

  // Find the target section's last entry
  let insertIndex = -1;
  let foundSection = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    // Check if we're entering the target section
    if (targetPatterns.some((p) => trimmed === p)) {
      foundSection = true;
      insertIndex = i + 1; // after the comment
      continue;
    }

    // If we're in the target section, track entries
    if (foundSection) {
      if (trimmed.startsWith("- path:")) {
        insertIndex = i + 1; // keep pushing past entries
      } else if (trimmed.startsWith("#") || trimmed === "") {
        // Hit the next section or blank line — stop
        break;
      }
    }
  }

  // If we didn't find the section, find the end of the include block
  // and add both the section comment and the entry
  if (!foundSection) {
    // Find the last include entry
    let lastIncludeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim().startsWith("- path:")) {
        lastIncludeIdx = i;
      }
    }
    if (lastIncludeIdx >= 0) {
      const sectionComment = `  ${targetPatterns[0]}`;
      lines.splice(lastIncludeIdx + 1, 0, sectionComment, newEntry);
    } else {
      // No include entries at all — append after `include:`
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.trim() === "include:") {
          const sectionComment = `  ${targetPatterns[0]}`;
          lines.splice(i + 1, 0, sectionComment, newEntry);
          break;
        }
      }
    }
  } else {
    lines.splice(insertIndex, 0, newEntry);
  }

  writeFileSync(fullPath, lines.join("\n"), "utf8");
}

// ─── Existing includes parser ───────────────────────────────

function getExistingIncludes(projectRoot: string): string[] {
  const fullPath = join(projectRoot, "docker-compose.yaml");
  if (!existsSync(fullPath)) return [];
  const content = readFileSync(fullPath, "utf8");
  const includes: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s*path:\s*(.+)$/);
    if (match) includes.push(match[1]!.trim());
  }
  return includes;
}

// ─── Compose file generation for components ─────────────────

function generateComponentCompose(
  name: string,
  type: Exclude<InitType, "project">,
  runtime: Runtime,
  owner: string,
  projectRoot: string,
): GeneratedFile | undefined {
  // Libraries don't get compose files
  if (type === "library") return undefined;

  const dir = type === "service" ? "services" : "apps";
  const catalogType = type === "service" ? "service" : "website";
  const labels = componentLabels({
    type: catalogType,
    owner,
    description: `${name} ${type}`,
    runtime,
    port: { number: 3000, name: "http", protocol: "http" },
  });

  // Detect existing postgres for DATABASE_URL wiring
  const existing = getExistingIncludes(projectRoot);
  const hasPostgres = existing.some((p) => p.includes("postgres"));

  const dependsOn = hasPostgres && type === "service"
    ? `    depends_on:
      infra-postgres:
        condition: service_healthy`
    : "";

  const envBlock = hasPostgres && type === "service"
    ? `    environment:
      DATABASE_URL: postgres://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/\${POSTGRES_DB:-app}`
    : "";

  const portEnvVar = `${name.toUpperCase().replace(/-/g, "_")}_PORT`;

  return {
    path: `compose/${name}.yml`,
    content: `services:
  ${name}:
    build:
      context: ../${dir}/${name}
      dockerfile: Dockerfile
    ports:
      - "\${${portEnvVar}:-3000}:3000"
${dependsOn ? dependsOn + "\n" : ""}${envBlock ? envBlock + "\n" : ""}    labels:
${labelsToYaml(labels, 6)}
`,
  };
}

// ─── Runtime to package dir mapping ─────────────────────────

function runtimeToPackageDir(runtime: Runtime): string {
  if (runtime === "node") return "npm";
  return runtime;
}

// ─── Main handler ───────────────────────────────────────────

export async function runAdd(opts: AddOptions): Promise<AddResult> {
  const { target, type, runtime, framework, owner, projectRoot, json } = opts;

  // ── Image addition ──────────────────────────────────────
  if (opts.image) {
    if (!isDockerRunning()) {
      throw new Error("Docker is not running. Start Docker and try again.");
    }

    const metadata = inspectImage(opts.image);
    const name = target || imageToName(opts.image);
    const composePath = `compose/${name}.yml`;

    // Collision check
    const existing = getExistingIncludes(projectRoot);
    if (existing.some((p) => p.includes(`${name}.yml`))) {
      throw new Error(`"${name}" is already included in docker-compose.yaml`);
    }
    if (existsSync(join(projectRoot, composePath))) {
      throw new Error(`File ${composePath} already exists`);
    }

    const resolvedOwner = owner || readOwnerFromCompose(projectRoot) || "local";
    const files = generateComposeFromImage(name, metadata, resolvedOwner);

    for (const file of files) {
      const fullPath = join(projectRoot, file.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf8");
    }

    updateComposeIncludes(projectRoot, composePath, "resources");

    const filePaths = files.map((f) => f.path);

    if (!json) {
      console.log(styleSuccess(`✔ Added "${name}" from image ${opts.image}`));
      const ports = metadata.exposedPorts;
      const vols = metadata.volumes;
      const envCount = Object.keys(metadata.env).length;
      console.log(styleMuted(`  Detected: ${ports.length} port(s), ${vols.length} volume(s), ${envCount} env var(s)`));
      for (const f of filePaths) {
        console.log(`  ${f}`);
      }
      console.log();
      console.log(styleMuted("docker-compose.yaml updated"));
    }

    return { category: "image", name, files: filePaths };
  }

  // ── Git source addition ─────────────────────────────────
  if (opts.from) {
    const gitResult = cloneAndExtract(opts.from, target);

    if (gitResult.files.length === 0) {
      throw new Error(`No compose files found in ${opts.from}`);
    }

    const resolvedOwner = owner || readOwnerFromCompose(projectRoot) || "local";
    const filePaths: string[] = [];

    for (const file of gitResult.files) {
      const fullPath = join(projectRoot, file.path);

      // Collision check
      if (existsSync(fullPath)) {
        throw new Error(`File ${file.path} already exists`);
      }

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf8");
      filePaths.push(file.path);
    }

    // Update docker-compose.yaml for each compose file
    for (const composePath of gitResult.composeFiles) {
      const existing = getExistingIncludes(projectRoot);
      if (!existing.includes(composePath)) {
        updateComposeIncludes(projectRoot, composePath, "resources");
      }
    }

    const name = target || gitResult.composeFiles[0]?.replace("compose/", "").replace(".yml", "") || "unknown";

    if (!json) {
      console.log(styleSuccess(`✔ Added from ${opts.from}`));
      for (const f of filePaths) {
        console.log(`  ${f}`);
      }
      console.log();
      console.log(styleMuted("docker-compose.yaml updated"));
    }

    return { category: "git", name, files: filePaths };
  }

  // ── Resource addition ─────────────────────────────────────
  if (target && isResourceName(target) && !type) {
    const resourceName = target as ResourceName;
    const composePath = `compose/${resourceName}.yml`;

    // Collision check
    const existing = getExistingIncludes(projectRoot);
    if (existing.some((p) => p.includes(`${resourceName}.yml`))) {
      throw new Error(`Resource "${resourceName}" is already included in docker-compose.yaml`);
    }
    if (existsSync(join(projectRoot, composePath))) {
      throw new Error(`File ${composePath} already exists`);
    }

    // Resolve owner from existing compose files if not provided
    const resolvedOwner = owner || readOwnerFromCompose(projectRoot) || "local";

    // Read project name from package.json or directory name
    const projectName = readProjectName(projectRoot);

    const files = generateResource(resourceName, { owner: resolvedOwner, projectName });

    // Write files
    for (const file of files) {
      const fullPath = join(projectRoot, file.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf8");
    }

    // Update docker-compose.yaml
    updateComposeIncludes(projectRoot, composePath, "resources");

    const filePaths = files.map((f) => f.path);

    if (!json) {
      console.log(styleSuccess(`✔ Added resource "${resourceName}"`));
      for (const f of filePaths) {
        console.log(`  ${f}`);
      }
      console.log();
      console.log(styleMuted("docker-compose.yaml updated"));
    }

    return { category: "resource", name: resourceName, files: filePaths };
  }

  // ── Component addition ────────────────────────────────────
  if (!type || !runtime) {
    throw new Error("Component type and runtime are required");
  }

  const name = target;
  if (!name) throw new Error("Component name is required");

  const resolvedFramework = framework!;
  const templateKey = resolveTemplateKey({ type, runtime, framework: resolvedFramework });

  // Determine target directory
  let targetDir: string;
  if (type === "service") {
    targetDir = `services/${name}`;
  } else if (type === "website") {
    targetDir = `apps/${name}`;
  } else {
    targetDir = `packages/${runtimeToPackageDir(runtime)}/${name}`;
  }

  // Collision checks
  if (existsSync(join(projectRoot, targetDir))) {
    throw new Error(`Directory ${targetDir}/ already exists`);
  }
  const composePath = `compose/${name}.yml`;
  if (type !== "library" && existsSync(join(projectRoot, composePath))) {
    throw new Error(`File ${composePath} already exists`);
  }

  // Resolve owner
  const resolvedOwner = owner || readOwnerFromCompose(projectRoot) || "local";

  // Generate standalone files, remapped into the target directory
  const vars: TemplateVars = { name, owner: resolvedOwner, description: "" };
  const standaloneFiles = generateStandalone(templateKey, vars);

  const filePaths: string[] = [];

  for (const file of standaloneFiles) {
    // Skip docker-compose.yaml from standalone output — we generate our own
    if (file.path === "docker-compose.yaml") continue;

    const remappedPath = `${targetDir}/${file.path}`;
    const fullPath = join(projectRoot, remappedPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf8");
    filePaths.push(remappedPath);
  }

  // Generate compose file for services and websites
  const composeFile = generateComponentCompose(name, type, runtime, resolvedOwner, projectRoot);
  if (composeFile) {
    const fullPath = join(projectRoot, composeFile.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, composeFile.content, "utf8");
    filePaths.push(composeFile.path);

    // Update docker-compose.yaml
    const section = type === "service" ? "services" : "apps";
    updateComposeIncludes(projectRoot, composePath, section);
  }

  if (!json) {
    console.log(styleSuccess(`✔ Added ${type} "${name}"`));
    console.log(`  ${targetDir}/`);
    if (composeFile) {
      console.log(`  ${composeFile.path}`);
    }
    console.log();
    console.log(styleMuted("docker-compose.yaml updated"));

    // Install hint
    if (runtime === "node") {
      console.log(styleMuted(`Run: pnpm install`));
    } else if (runtime === "java") {
      console.log(styleMuted(`Run: mvn install`));
    } else if (runtime === "python") {
      console.log(styleMuted(`Run: uv sync`));
    }
  }

  return { category: "component", name, files: filePaths };
}

// ─── Helpers ────────────────────────────────────────────────

function readOwnerFromCompose(projectRoot: string): string | undefined {
  const composeDir = join(projectRoot, "compose");
  if (!existsSync(composeDir)) return undefined;

  // Try to read owner from any existing compose file
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(composeDir).filter((f: string) => f.endsWith(".yml"));
  for (const file of files) {
    const content = readFileSync(join(composeDir, file), "utf8");
    const match = content.match(/catalog\.owner:\s*(.+)/);
    if (match) return match[1]!.trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function readProjectName(projectRoot: string): string {
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  // Fallback to directory name
  const { basename } = require("node:path") as typeof import("node:path");
  return basename(projectRoot);
}
