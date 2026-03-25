import { spawnSync } from "node:child_process";

export function isDockerRunning(): boolean {
  const proc = spawnSync("docker", ["info"], {
    encoding: "utf8",
  });
  return proc.status === 0;
}

export function composeUp(
  composeFile: string,
  opts?: { detach?: boolean; build?: boolean; projectName?: string }
): void {
  const args = ["compose"];
  if (opts?.projectName) {
    args.push("-p", opts.projectName);
  }
  args.push("-f", composeFile, "up");
  if (opts?.detach !== false) args.push("-d");
  if (opts?.build) args.push("--build");
  const proc = spawnSync("docker", args, {
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("docker compose up failed");
  }
}

export function composeDown(
  composeFile: string,
  opts?: { projectName?: string }
): void {
  const args = ["compose"];
  if (opts?.projectName) {
    args.push("-p", opts.projectName);
  }
  args.push("-f", composeFile, "down");
  const proc = spawnSync("docker", args, {
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("docker compose down failed");
  }
}

export function dockerBuild(
  context: string,
  dockerfile: string,
  tag: string
): void {
  const proc = spawnSync(
    "docker",
    ["build", "-f", dockerfile, "-t", tag, context],
    {
      stdio: "inherit",
    }
  );
  if (proc.status !== 0) {
    throw new Error(`docker build failed for tag ${tag}`);
  }
}
