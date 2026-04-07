import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { RUN_JS } from "./run-dx.js";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-add-git-test-"));
}

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-add-git-home-"));
}

function readFile(dir: string, ...segments: string[]): string {
  return readFileSync(path.join(dir, ...segments), "utf8");
}

function runDxInDir(
  args: string[],
  cwd: string,
  home: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [RUN_JS, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function createProject(dir: string, home: string): void {
  const result = spawnSync(
    "bun",
    [RUN_JS, "init", "--name", "test-proj", "--owner", "team", "--dir", dir],
    {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to create project: ${result.stderr}`);
  }
}

/** Create a local git repo with a compose file for testing. */
function createGitFixture(content: string, fileName = "docker-compose.yml"): string {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "dx-git-fixture-"));
  writeFileSync(path.join(repoDir, fileName), content, "utf8");

  spawnSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: repoDir,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });

  return repoDir;
}

/** Create a git fixture with files in a compose/ directory. */
function createGitFixtureWithComposeDir(
  files: Record<string, string>,
): string {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "dx-git-fixture-"));
  mkdirSync(path.join(repoDir, "compose"), { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(repoDir, "compose", name), content, "utf8");
  }

  spawnSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: repoDir,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });

  return repoDir;
}

// ─── Git Source Addition ────────────────────────────────────────────────────

describe("dx add --from (git)", () => {
  let dir: string;
  let home: string;
  const fixtures: string[] = [];

  beforeEach(() => {
    dir = tmpDir();
    home = isolatedHome();
    createProject(dir, home);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    for (const f of fixtures) {
      rmSync(f, { recursive: true, force: true });
    }
    fixtures.length = 0;
  });

  it("adds from a git repo with root compose file", () => {
    const composeContent = `services:
  my-service:
    image: node:22-alpine
    ports:
      - "3000:3000"
`;
    const fixture = createGitFixture(composeContent);
    fixtures.push(fixture);

    const { status, stderr } = runDxInDir(
      ["add", "my-svc", "--from", fixture],
      dir,
      home,
    );

    expect(status).toBe(0);
    expect(stderr).toBe("");

    // Compose file created with provided name
    expect(existsSync(path.join(dir, "compose/my-svc.yml"))).toBe(true);

    const compose = readFile(dir, "compose/my-svc.yml");
    expect(compose).toContain("my-service:");
    expect(compose).toContain("node:22-alpine");

    // docker-compose.yaml updated
    const rootCompose = readFile(dir, "docker-compose.yaml");
    expect(rootCompose).toContain("compose/my-svc.yml");
  });

  it("adds from a git repo with compose/ directory", () => {
    const fixture = createGitFixtureWithComposeDir({
      "cache.yml": `services:
  cache:
    image: redis:7-alpine
    ports:
      - "6379:6379"
`,
    });
    fixtures.push(fixture);

    const { status } = runDxInDir(
      ["add", "--from", fixture],
      dir,
      home,
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "compose/cache.yml"))).toBe(true);

    const rootCompose = readFile(dir, "docker-compose.yaml");
    expect(rootCompose).toContain("compose/cache.yml");
  });

  it("--json returns structured output", () => {
    const composeContent = `services:
  thing:
    image: alpine:latest
`;
    const fixture = createGitFixture(composeContent);
    fixtures.push(fixture);

    const { status, stdout } = runDxInDir(
      ["add", "my-thing", "--from", fixture, "--json"],
      dir,
      home,
    );
    expect(status).toBe(0);

    const body = JSON.parse(stdout) as {
      success: boolean;
      category: string;
      name: string;
      files: string[];
    };
    expect(body.success).toBe(true);
    expect(body.category).toBe("git");
    expect(body.name).toBe("my-thing");
    expect(body.files).toContain("compose/my-thing.yml");
  });

  it("fails when no compose files found in repo", () => {
    // Create a repo with no compose files
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "dx-git-fixture-"));
    writeFileSync(path.join(repoDir, "README.md"), "# Hello\n", "utf8");
    spawnSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    spawnSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
    spawnSync("git", ["commit", "-m", "init"], {
      cwd: repoDir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });
    fixtures.push(repoDir);

    const { status, stderr } = runDxInDir(
      ["add", "--from", repoDir],
      dir,
      home,
    );
    expect(status).not.toBe(0);
    expect(stderr).toContain("No compose files found");
  });
});
