import { spawnSync } from "node:child_process";

export function getCurrentBranch(cwd: string): string {
  const proc = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(
      (proc.stderr || "").trim() || "git rev-parse failed (is this a git repository?)"
    );
  }
  return (proc.stdout || "").trim();
}

export function hasUncommittedChanges(cwd: string): boolean {
  const proc = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) return true;
  return (proc.stdout || "").trim().length > 0;
}

export function stageAll(cwd: string): void {
  const proc = spawnSync("git", ["add", "-A"], {
    cwd,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("git add -A failed");
  }
}

export function gitCommit(cwd: string, message: string): string {
  const proc = spawnSync("git", ["commit", "-m", message], {
    cwd,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("git commit failed");
  }
  const show = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (show.status !== 0) {
    throw new Error("git rev-parse HEAD failed");
  }
  return (show.stdout || "").trim();
}

export function gitPush(cwd: string, opts?: { setUpstream?: boolean }): void {
  const branch = getCurrentBranch(cwd);
  const args = opts?.setUpstream ? ["push", "-u", "origin", branch] : ["push"];
  const proc = spawnSync("git", args, {
    cwd,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("git push failed");
  }
}

export function createBranch(cwd: string, name: string): void {
  const proc = spawnSync("git", ["checkout", "-b", name], {
    cwd,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error(`Could not create branch "${name}"`);
  }
}

export function listBranches(cwd: string): string {
  const proc = spawnSync("git", ["branch", "--list"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error("git branch --list failed");
  }
  return (proc.stdout || "").trim();
}
