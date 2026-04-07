import { spawnSync } from "node:child_process";

export function getGitCommonDir(cwd: string): string {
  const proc = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(
      (proc.stderr || "").trim() || "git rev-parse --git-common-dir failed"
    );
  }
  return (proc.stdout || "").trim();
}

export function getGitDir(cwd: string): string {
  const proc = spawnSync("git", ["rev-parse", "--git-dir"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(
      (proc.stderr || "").trim() || "git rev-parse --git-dir failed"
    );
  }
  return (proc.stdout || "").trim();
}

export function getShortSha(cwd: string): string {
  const proc = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) return "";
  return (proc.stdout || "").trim();
}

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

export function getRemoteUrl(cwd: string): string {
  const proc = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  if (proc.status !== 0) throw new Error("No git remote 'origin' found");
  return (proc.stdout || "").trim();
}

export function getAheadBehind(cwd: string): { ahead: number; behind: number } {
  const proc = spawnSync("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, encoding: "utf8" });
  if (proc.status !== 0) return { ahead: 0, behind: 0 };
  const [ahead, behind] = (proc.stdout || "").trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
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
