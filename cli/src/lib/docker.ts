import { spawnSync } from "node:child_process";

export function isDockerRunning(): boolean {
  const proc = spawnSync("docker", ["info"], {
    encoding: "utf8",
  });
  return proc.status === 0;
}

/** Shared compose opts for all compose functions */
interface ComposeOpts {
  projectName?: string;
  profiles?: string[];
  envFile?: string;
}

/** Build compose args: -f file1 -f file2 --env-file ... --profile p1 */
function composeFileArgs(
  composeFiles: string | string[],
  opts?: ComposeOpts,
): string[] {
  const args = ["compose"];
  if (opts?.projectName) {
    args.push("-p", opts.projectName);
  }
  const files = Array.isArray(composeFiles) ? composeFiles : [composeFiles];
  for (const f of files) {
    args.push("-f", f);
  }
  if (opts?.envFile) {
    args.push("--env-file", opts.envFile);
  }
  if (opts?.profiles) {
    for (const p of opts.profiles) {
      args.push("--profile", p);
    }
  }
  return args;
}

export function composeUp(
  composeFiles: string | string[],
  opts?: ComposeOpts & {
    detach?: boolean;
    build?: boolean;
    noBuild?: boolean;
    services?: string[];
  },
): void {
  const args = composeFileArgs(composeFiles, opts);
  args.push("up");
  if (opts?.detach !== false) args.push("-d");
  if (opts?.noBuild) {
    args.push("--no-build");
  } else if (opts?.build !== false) {
    args.push("--build");
  }
  if (opts?.services?.length) {
    args.push(...opts.services);
  }
  const proc = spawnSync("docker", args, {
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("docker compose up failed");
  }
}

export function composeDown(
  composeFiles: string | string[],
  opts?: ComposeOpts & { volumes?: boolean },
): void {
  const args = composeFileArgs(composeFiles, opts);
  args.push("down");
  if (opts?.volumes) args.push("--volumes");
  const proc = spawnSync("docker", args, {
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("docker compose down failed");
  }
}

export function composeStop(
  composeFiles: string | string[],
  services: string[],
  opts?: ComposeOpts,
): void {
  const args = composeFileArgs(composeFiles, opts);
  args.push("stop", ...services);
  spawnSync("docker", args, { stdio: "inherit" });
}

export function composeIsRunning(
  composeFiles: string | string[],
  service: string,
  opts?: ComposeOpts,
): boolean {
  const args = composeFileArgs(composeFiles, opts);
  args.push("ps", "-q", service);
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

export function composeRestart(
  composeFiles: string | string[],
  services: string[],
  opts?: ComposeOpts,
): void {
  const args = composeFileArgs(composeFiles, opts);
  args.push("restart", ...services);
  const proc = spawnSync("docker", args, { stdio: "inherit" });
  if (proc.status !== 0) {
    throw new Error("docker compose restart failed");
  }
}

export function composeBuild(
  composeFiles: string | string[],
  services: string[],
  opts?: ComposeOpts,
): void {
  const args = composeFileArgs(composeFiles, opts);
  args.push("build", ...services);
  const proc = spawnSync("docker", args, { stdio: "inherit" });
  if (proc.status !== 0) {
    throw new Error("docker compose build failed");
  }
}

export function dockerBuild(
  context: string,
  dockerfile: string,
  tag: string,
): void {
  const proc = spawnSync(
    "docker",
    ["build", "-f", dockerfile, "-t", tag, context],
    {
      stdio: "inherit",
    },
  );
  if (proc.status !== 0) {
    throw new Error(`docker build failed for tag ${tag}`);
  }
}
