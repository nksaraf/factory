import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────

export type DetectedRuntime = "node" | "python" | "java" | "go" | "rust";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface DetectedTool {
  /** Tool name, e.g. "vitest", "eslint", "drizzle" */
  tool: string;
  /** Config file that triggered detection, e.g. "vitest.config.ts" */
  configFile: string;
  /** Command to execute, e.g. "vitest run" */
  runCmd: string;
  /** How it was found */
  source: "auto-detect" | "package.json";
}

export interface DetectedDatabase {
  engine: "postgres" | "mysql" | "mongo";
  /** Docker-compose service name */
  service: string;
  /** Host port */
  port: number;
}

export interface DetectedToolchain {
  runtime: DetectedRuntime | null;
  packageManager: PackageManager | null;
  testRunner: DetectedTool | null;
  linter: DetectedTool | null;
  formatter: DetectedTool | null;
  typeChecker: DetectedTool | null;
  migrationTool: DetectedTool | null;
  codegen: DetectedTool[];
  framework: string | null;
  database: DetectedDatabase | null;
}

// ─── Helpers ────────────────────────────────────────────────

function fileExists(dir: string, name: string): boolean {
  return existsSync(join(dir, name));
}

function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    if (fileExists(dir, name)) return name;
  }
  return null;
}

function readPackageJson(dir: string): Record<string, any> | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function hasDependency(pkg: Record<string, any>, name: string): boolean {
  return Boolean(pkg.devDependencies?.[name] || pkg.dependencies?.[name]);
}

function getScript(pkg: Record<string, any>, name: string): string | undefined {
  return pkg.scripts?.[name];
}

// ─── Runtime Detection ──────────────────────────────────────

function detectRuntime(dir: string): DetectedRuntime | null {
  if (fileExists(dir, "package.json")) return "node";
  if (fileExists(dir, "go.mod")) return "go";
  if (fileExists(dir, "Cargo.toml")) return "rust";
  if (fileExists(dir, "pyproject.toml") || fileExists(dir, "setup.py")) return "python";
  if (fileExists(dir, "pom.xml") || fileExists(dir, "build.gradle")) return "java";
  return null;
}

// ─── Package Manager Detection ──────────────────────────────

function detectPackageManager(dir: string, pkg: Record<string, any> | null): PackageManager | null {
  // packageManager field in package.json takes precedence
  if (pkg?.packageManager) {
    const pm = pkg.packageManager as string;
    if (pm.startsWith("pnpm")) return "pnpm";
    if (pm.startsWith("yarn")) return "yarn";
    if (pm.startsWith("npm")) return "npm";
    if (pm.startsWith("bun")) return "bun";
  }
  // Fall back to lockfile detection
  if (fileExists(dir, "pnpm-lock.yaml")) return "pnpm";
  if (fileExists(dir, "bun.lockb") || fileExists(dir, "bun.lock")) return "bun";
  if (fileExists(dir, "yarn.lock")) return "yarn";
  if (fileExists(dir, "package-lock.json")) return "npm";
  // If package.json exists but no lockfile, default to pnpm
  if (pkg) return "pnpm";
  return null;
}

// ─── Test Runner Detection ──────────────────────────────────

function detectTestRunner(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): DetectedTool | null {
  // 1. package.json script override
  const testScript = getScript(pkg ?? {}, "test");
  if (testScript) {
    return { tool: "custom", configFile: "package.json", runCmd: testScript, source: "package.json" };
  }

  // 2. Auto-detect by runtime
  if (runtime === "node") {
    const vitestConfig = firstExisting(dir, ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs"]);
    if (vitestConfig) return { tool: "vitest", configFile: vitestConfig, runCmd: "vitest run", source: "auto-detect" };

    const jestConfig = firstExisting(dir, ["jest.config.ts", "jest.config.js", "jest.config.mjs", "jest.config.cjs"]);
    if (jestConfig) return { tool: "jest", configFile: jestConfig, runCmd: "jest", source: "auto-detect" };

    // Check package.json for jest config key
    if (pkg?.jest) return { tool: "jest", configFile: "package.json", runCmd: "jest", source: "auto-detect" };
  }

  if (runtime === "python") {
    const pytestConfig = firstExisting(dir, ["pytest.ini", "conftest.py", "setup.cfg"]);
    if (pytestConfig) return { tool: "pytest", configFile: pytestConfig, runCmd: "pytest", source: "auto-detect" };
    // Check pyproject.toml for [tool.pytest] section
    if (fileExists(dir, "pyproject.toml")) {
      try {
        const content = readFileSync(join(dir, "pyproject.toml"), "utf-8");
        if (content.includes("[tool.pytest")) return { tool: "pytest", configFile: "pyproject.toml", runCmd: "pytest", source: "auto-detect" };
      } catch { /* ignore */ }
    }
  }

  if (runtime === "java") {
    if (fileExists(dir, "build.gradle")) return { tool: "gradle", configFile: "build.gradle", runCmd: "./gradlew test", source: "auto-detect" };
    if (fileExists(dir, "pom.xml")) return { tool: "maven", configFile: "pom.xml", runCmd: "mvn test", source: "auto-detect" };
  }

  if (runtime === "go") {
    return { tool: "go-test", configFile: "go.mod", runCmd: "go test ./...", source: "auto-detect" };
  }

  if (runtime === "rust") {
    return { tool: "cargo-test", configFile: "Cargo.toml", runCmd: "cargo test", source: "auto-detect" };
  }

  return null;
}

// ─── Linter Detection ───────────────────────────────────────

function detectLinter(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): DetectedTool | null {
  const lintScript = getScript(pkg ?? {}, "lint");
  if (lintScript) {
    return { tool: "custom", configFile: "package.json", runCmd: lintScript, source: "package.json" };
  }

  if (runtime === "node") {
    const eslintConfig = firstExisting(dir, ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc"]);
    if (eslintConfig) return { tool: "eslint", configFile: eslintConfig, runCmd: "eslint . --fix", source: "auto-detect" };

    if (fileExists(dir, "biome.json") || fileExists(dir, "biome.jsonc"))
      return { tool: "biome", configFile: "biome.json", runCmd: "biome check --fix", source: "auto-detect" };

    const oxlintConfig = firstExisting(dir, ["oxlint.config.json", ".oxlintrc.json"]);
    if (oxlintConfig || hasDependency(pkg ?? {}, "oxlint"))
      return { tool: "oxlint", configFile: oxlintConfig ?? "package.json", runCmd: "oxlint .", source: "auto-detect" };
  }

  if (runtime === "python") {
    if (fileExists(dir, "ruff.toml")) return { tool: "ruff", configFile: "ruff.toml", runCmd: "ruff check . --fix", source: "auto-detect" };
    if (fileExists(dir, "pyproject.toml")) {
      try {
        const content = readFileSync(join(dir, "pyproject.toml"), "utf-8");
        if (content.includes("[tool.ruff")) return { tool: "ruff", configFile: "pyproject.toml", runCmd: "ruff check . --fix", source: "auto-detect" };
      } catch { /* ignore */ }
    }
  }

  if (runtime === "go") {
    if (firstExisting(dir, [".golangci-lint.yaml", ".golangci-lint.yml", ".golangci.yml"]))
      return { tool: "golangci-lint", configFile: ".golangci-lint.yaml", runCmd: "golangci-lint run", source: "auto-detect" };
  }

  if (runtime === "rust") {
    return { tool: "clippy", configFile: "Cargo.toml", runCmd: "cargo clippy", source: "auto-detect" };
  }

  return null;
}

// ─── Formatter Detection ────────────────────────────────────

const PRETTIER_CONFIGS = [
  ".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.yaml",
  ".prettierrc.yml", ".prettierrc.cjs", ".prettierrc.mjs",
  "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs",
];

function detectFormatter(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): DetectedTool | null {
  const formatScript = getScript(pkg ?? {}, "format");
  if (formatScript) {
    return { tool: "custom", configFile: "package.json", runCmd: formatScript, source: "package.json" };
  }

  if (runtime === "node") {
    if (fileExists(dir, "biome.json") || fileExists(dir, "biome.jsonc"))
      return { tool: "biome", configFile: "biome.json", runCmd: "biome format --write", source: "auto-detect" };

    const prettierConfig = firstExisting(dir, PRETTIER_CONFIGS);
    if (prettierConfig) return { tool: "prettier", configFile: prettierConfig, runCmd: "prettier --write .", source: "auto-detect" };

    // Check package.json for prettier key
    if (pkg?.prettier) return { tool: "prettier", configFile: "package.json", runCmd: "prettier --write .", source: "auto-detect" };
  }

  if (runtime === "python") {
    if (fileExists(dir, "ruff.toml")) return { tool: "ruff", configFile: "ruff.toml", runCmd: "ruff format .", source: "auto-detect" };
    if (fileExists(dir, "pyproject.toml")) {
      try {
        const content = readFileSync(join(dir, "pyproject.toml"), "utf-8");
        if (content.includes("[tool.ruff")) return { tool: "ruff", configFile: "pyproject.toml", runCmd: "ruff format .", source: "auto-detect" };
      } catch { /* ignore */ }
    }
  }

  if (runtime === "go") {
    return { tool: "gofmt", configFile: "go.mod", runCmd: "gofmt -w .", source: "auto-detect" };
  }

  if (runtime === "rust") {
    return { tool: "rustfmt", configFile: "Cargo.toml", runCmd: "cargo fmt", source: "auto-detect" };
  }

  return null;
}

// ─── Type Checker Detection ─────────────────────────────────

function detectTypeChecker(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): DetectedTool | null {
  const typecheckScript = getScript(pkg ?? {}, "typecheck");
  if (typecheckScript) {
    return { tool: "custom", configFile: "package.json", runCmd: typecheckScript, source: "package.json" };
  }

  if (runtime === "node") {
    if (fileExists(dir, "tsconfig.json"))
      return { tool: "tsc", configFile: "tsconfig.json", runCmd: "tsc --noEmit", source: "auto-detect" };
  }

  if (runtime === "python") {
    if (fileExists(dir, "pyproject.toml")) {
      try {
        const content = readFileSync(join(dir, "pyproject.toml"), "utf-8");
        if (content.includes("[tool.pyright")) return { tool: "pyright", configFile: "pyproject.toml", runCmd: "pyright", source: "auto-detect" };
        if (content.includes("[tool.mypy") || content.includes("[mypy]")) return { tool: "mypy", configFile: "pyproject.toml", runCmd: "mypy .", source: "auto-detect" };
      } catch { /* ignore */ }
    }
    if (fileExists(dir, "mypy.ini")) return { tool: "mypy", configFile: "mypy.ini", runCmd: "mypy .", source: "auto-detect" };
    if (fileExists(dir, "pyrightconfig.json")) return { tool: "pyright", configFile: "pyrightconfig.json", runCmd: "pyright", source: "auto-detect" };
  }

  // Go and Rust: compiler handles types — skip silently
  return null;
}

// ─── Migration Tool Detection ───────────────────────────────

function detectMigrationTool(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): DetectedTool | null {
  const migrateScript = getScript(pkg ?? {}, "db:migrate");
  if (migrateScript) {
    return { tool: "custom", configFile: "package.json", runCmd: migrateScript, source: "package.json" };
  }

  // Prisma
  if (fileExists(dir, "prisma/schema.prisma"))
    return { tool: "prisma", configFile: "prisma/schema.prisma", runCmd: "prisma migrate deploy", source: "auto-detect" };

  // Drizzle
  const drizzleConfig = firstExisting(dir, ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.json"]);
  if (drizzleConfig) return { tool: "drizzle", configFile: drizzleConfig, runCmd: "drizzle-kit migrate", source: "auto-detect" };

  // Knex
  const knexConfig = firstExisting(dir, ["knexfile.ts", "knexfile.js"]);
  if (knexConfig) return { tool: "knex", configFile: knexConfig, runCmd: "knex migrate:latest", source: "auto-detect" };

  // Python: Alembic
  if (runtime === "python" && fileExists(dir, "alembic.ini"))
    return { tool: "alembic", configFile: "alembic.ini", runCmd: "alembic upgrade head", source: "auto-detect" };

  // Python: Django
  if (runtime === "python" && fileExists(dir, "manage.py"))
    return { tool: "django", configFile: "manage.py", runCmd: "python manage.py migrate", source: "auto-detect" };

  // Go: golang-migrate
  if (runtime === "go" && fileExists(dir, "migrations"))
    return { tool: "golang-migrate", configFile: "migrations/", runCmd: "migrate -path migrations -database $DATABASE_URL up", source: "auto-detect" };

  // Java: Flyway
  if (runtime === "java" && (fileExists(dir, "src/main/resources/db/migration") || fileExists(dir, "flyway.conf")))
    return { tool: "flyway", configFile: "flyway.conf", runCmd: "flyway migrate", source: "auto-detect" };

  return null;
}

// ─── Codegen Detection ──────────────────────────────────────

function detectCodegen(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): DetectedTool[] {
  const generateScript = getScript(pkg ?? {}, "generate");
  if (generateScript) {
    return [{ tool: "custom", configFile: "package.json", runCmd: generateScript, source: "package.json" }];
  }

  const tools: DetectedTool[] = [];

  // Prisma generate
  if (fileExists(dir, "prisma/schema.prisma"))
    tools.push({ tool: "prisma", configFile: "prisma/schema.prisma", runCmd: "prisma generate", source: "auto-detect" });

  // Drizzle generate
  const drizzleConfig = firstExisting(dir, ["drizzle.config.ts", "drizzle.config.js"]);
  if (drizzleConfig)
    tools.push({ tool: "drizzle-kit", configFile: drizzleConfig, runCmd: "drizzle-kit generate", source: "auto-detect" });

  // GraphQL codegen
  const gqlConfig = firstExisting(dir, ["codegen.ts", "codegen.yml", "codegen.yaml", "graphql.config.ts", "graphql.config.js"]);
  if (gqlConfig)
    tools.push({ tool: "graphql-codegen", configFile: gqlConfig, runCmd: "graphql-codegen", source: "auto-detect" });

  // OpenAPI TypeScript
  if (pkg && hasDependency(pkg, "openapi-typescript")) {
    const specFile = firstExisting(dir, ["api/openapi.yaml", "openapi.yaml", "openapi.json"]);
    if (specFile)
      tools.push({ tool: "openapi-typescript", configFile: specFile, runCmd: `openapi-typescript ${specFile} -o src/types/api.ts`, source: "auto-detect" });
  }

  // sqlc
  if (fileExists(dir, "sqlc.yaml") || fileExists(dir, "sqlc.yml"))
    tools.push({ tool: "sqlc", configFile: "sqlc.yaml", runCmd: "sqlc generate", source: "auto-detect" });

  return tools;
}

// ─── Framework Detection ────────────────────────────────────

function detectFramework(dir: string, runtime: DetectedRuntime | null, pkg: Record<string, any> | null): string | null {
  if (runtime === "node") {
    if (firstExisting(dir, ["next.config.js", "next.config.mjs", "next.config.ts"])) return "next";
    if (firstExisting(dir, ["nuxt.config.ts", "nuxt.config.js"])) return "nuxt";
    if (firstExisting(dir, ["app.config.ts"]) && pkg && hasDependency(pkg, "vinxi")) return "vinxi";
    if (firstExisting(dir, ["vite.config.ts", "vite.config.js", "vite.config.mjs"])) return "vite";
    if (firstExisting(dir, ["astro.config.mjs", "astro.config.ts"])) return "astro";
    if (pkg && hasDependency(pkg, "elysia")) return "elysia";
    if (pkg && hasDependency(pkg, "express")) return "express";
    if (pkg && hasDependency(pkg, "fastify")) return "fastify";
    if (pkg && hasDependency(pkg, "hono")) return "hono";
  }

  if (runtime === "python") {
    if (fileExists(dir, "manage.py")) return "django";
    if (fileExists(dir, "pyproject.toml")) {
      try {
        const content = readFileSync(join(dir, "pyproject.toml"), "utf-8");
        if (content.includes("fastapi")) return "fastapi";
        if (content.includes("flask")) return "flask";
        if (content.includes("django")) return "django";
      } catch { /* ignore */ }
    }
  }

  if (runtime === "java") {
    if (fileExists(dir, "pom.xml")) {
      try {
        const content = readFileSync(join(dir, "pom.xml"), "utf-8");
        if (content.includes("spring-boot")) return "spring-boot";
        if (content.includes("quarkus")) return "quarkus";
        if (content.includes("micronaut")) return "micronaut";
      } catch { /* ignore */ }
    }
  }

  if (runtime === "go") {
    if (fileExists(dir, "air.toml") || fileExists(dir, ".air.toml")) return "air";
  }

  return null;
}

// ─── Main Detector ──────────────────────────────────────────

/**
 * Detect the full toolchain for a project directory.
 * Checks for config files, package.json scripts, and well-known patterns
 * to determine what tools are available.
 */
export function detectToolchain(dir: string): DetectedToolchain {
  const runtime = detectRuntime(dir);
  const pkg = readPackageJson(dir);
  const packageManager = detectPackageManager(dir, pkg);

  return {
    runtime,
    packageManager,
    testRunner: detectTestRunner(dir, runtime, pkg),
    linter: detectLinter(dir, runtime, pkg),
    formatter: detectFormatter(dir, runtime, pkg),
    typeChecker: detectTypeChecker(dir, runtime, pkg),
    migrationTool: detectMigrationTool(dir, runtime, pkg),
    codegen: detectCodegen(dir, runtime, pkg),
    framework: detectFramework(dir, runtime, pkg),
    database: null, // populated from docker-compose by ProjectContext
  };
}

/**
 * Resolve the command for a variant flag.
 * E.g., `resolveVariant("test", "watch", toolchain, pkg)` checks for
 * `scripts["test:watch"]` first, then adapts the detected test runner.
 */
export function resolveVariant(
  command: string,
  variant: string,
  tool: DetectedTool | null,
  pkg: Record<string, any> | null,
): DetectedTool | null {
  // 1. Check for package.json script with colon-separated variant
  const scriptKey = `${command}:${variant}`;
  const script = getScript(pkg ?? {}, scriptKey);
  if (script) {
    return { tool: "custom", configFile: "package.json", runCmd: script, source: "package.json" };
  }

  // 2. Adapt detected tool with variant flag
  if (!tool || tool.source === "package.json") return tool;

  const variantMap: Record<string, Record<string, string>> = {
    vitest: {
      watch: "vitest",  // vitest without "run" is already watch mode
      changed: "vitest run --changed",
      coverage: "vitest run --coverage",
      integration: "vitest -c vitest.integration.config.ts",
      e2e: "vitest -c vitest.e2e.config.ts",
    },
    jest: {
      watch: "jest --watch",
      changed: "jest --changedSince HEAD~1",
      coverage: "jest --coverage",
    },
    pytest: {
      watch: "pytest-watch",
      changed: "pytest",  // pytest doesn't have a native changed mode
      integration: "pytest -m integration",
      coverage: "pytest --cov",
    },
    "go-test": {
      integration: "go test -tags=integration ./...",
      coverage: "go test -cover ./...",
    },
  };

  const toolVariants = variantMap[tool.tool];
  if (toolVariants?.[variant]) {
    return { ...tool, runCmd: toolVariants[variant] };
  }

  return tool;
}
