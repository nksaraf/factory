/**
 * Parallel toolchain checks for workbench setup.
 *
 * All checks run concurrently via Promise.all, each invoking the
 * tool's version command and comparing against the minimum version.
 */

import { capture } from "../../lib/subprocess.js";
import type { ToolchainCheck, ToolchainResult } from "@smp/factory-shared/install-types";

type Platform = "darwin" | "linux" | "win32";

interface InstallInstructions {
  darwin?: string;
  linux?: string;
  win32?: string;
}

interface ToolDef {
  name: string;
  cmd: string;
  args: string[];
  versionExtract: (stdout: string, stderr: string) => string;
  minVersion?: string;
  required: boolean;
  install?: InstallInstructions;
}

const WORKBENCH_TOOLS: ToolDef[] = [
  {
    name: "node",
    cmd: "node",
    args: ["--version"],
    versionExtract: (stdout) => stdout.trim().replace(/^v/, ""),
    minVersion: "20",
    required: true,
    install: {
      darwin: "brew install node",
      linux: "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs",
      win32: "winget install OpenJS.NodeJS.LTS",
    },
  },
  {
    name: "java",
    cmd: "java",
    args: ["--version"],
    // java outputs to stderr; look for "openjdk X.Y.Z" or "java X.Y.Z"
    versionExtract: (_stdout, stderr) => {
      const combined = stderr || _stdout;
      const m = combined.match(/(?:openjdk|java)\s+(\d[\d.]*)/i);
      return m?.[1] ?? "";
    },
    minVersion: "21",
    required: true,
    install: {
      darwin: "brew install openjdk@21",
      linux: "sudo apt-get install -y openjdk-21-jdk",
      win32: "winget install EclipseAdoptium.Temurin.21.JDK",
    },
  },
  {
    name: "python",
    cmd: "python3",
    args: ["--version"],
    versionExtract: (stdout) => {
      const m = stdout.match(/Python\s+(\d[\d.]*)/);
      return m?.[1] ?? "";
    },
    minVersion: "3.11",
    required: true,
    install: {
      darwin: "brew install python@3.12",
      linux: "sudo apt-get install -y python3",
      win32: "winget install Python.Python.3.12",
    },
  },
  {
    name: "docker",
    cmd: "docker",
    args: ["--version"],
    versionExtract: (stdout) => {
      const m = stdout.match(/Docker version\s+(\d[\d.]*)/);
      return m?.[1] ?? "";
    },
    minVersion: "24",
    required: true,
    install: {
      darwin: "brew install --cask docker",
      linux: "curl -fsSL https://get.docker.com | sh",
      win32: "winget install Docker.DockerDesktop",
    },
  },
  {
    name: "git",
    cmd: "git",
    args: ["--version"],
    versionExtract: (stdout) => {
      const m = stdout.match(/git version\s+(\d[\d.]*)/);
      return m?.[1] ?? "";
    },
    minVersion: "2.30",
    required: true,
    install: {
      darwin: "brew install git",
      linux: "sudo apt-get install -y git",
      win32: "winget install Git.Git",
    },
  },
  {
    name: "bun",
    cmd: "bun",
    args: ["--version"],
    versionExtract: (stdout) => stdout.trim(),
    required: true,
    install: {
      darwin: "curl -fsSL https://bun.sh/install | bash",
      linux: "curl -fsSL https://bun.sh/install | bash",
      win32: "powershell -c \"irm bun.sh/install.ps1 | iex\"",
    },
  },
  {
    name: "pnpm",
    cmd: "pnpm",
    args: ["--version"],
    versionExtract: (stdout) => stdout.trim(),
    minVersion: "9",
    required: true,
    install: {
      darwin: "npm install -g pnpm",
      linux: "npm install -g pnpm",
      win32: "npm install -g pnpm",
    },
  },
  {
    name: "corepack",
    cmd: "corepack",
    args: ["--version"],
    versionExtract: (stdout) => stdout.trim(),
    required: false,
    install: {
      darwin: "npm install -g corepack",
      linux: "npm install -g corepack",
      win32: "npm install -g corepack",
    },
  },
  {
    name: "gcloud",
    cmd: "gcloud",
    args: ["version"],
    versionExtract: (stdout) => {
      const m = stdout.match(/Google Cloud SDK\s+(\d[\d.]*)/);
      return m?.[1] ?? "";
    },
    required: true,
    install: {
      darwin: "brew install --cask google-cloud-sdk",
      linux: "curl https://sdk.cloud.google.com | bash",
      win32: "winget install Google.CloudSDK",
    },
  },
  {
    name: "curl",
    cmd: "curl",
    args: ["--version"],
    versionExtract: (stdout) => {
      const m = stdout.match(/curl\s+(\d[\d.]*)/);
      return m?.[1] ?? "";
    },
    required: false,
    install: {
      darwin: "brew install curl",
      linux: "sudo apt-get install -y curl",
      win32: "winget install cURL.cURL",
    },
  },
  {
    name: "claude",
    cmd: "claude",
    args: ["--version"],
    versionExtract: (stdout) => stdout.trim(),
    required: false,
    install: {
      darwin: "npm install -g @anthropic-ai/claude-code",
      linux: "npm install -g @anthropic-ai/claude-code",
      win32: "npm install -g @anthropic-ai/claude-code",
    },
  },
  {
    name: "k3d",
    cmd: "k3d",
    args: ["version"],
    versionExtract: (stdout) => {
      const m = stdout.match(/k3d version\s+v?(\d[\d.]*)/);
      return m?.[1] ?? stdout.trim();
    },
    required: false,
    install: {
      darwin: "brew install k3d",
      linux: "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash",
      win32: "choco install k3d",
    },
  },
];

/**
 * Compare two dot-separated version strings.
 * Returns true if `actual >= minimum`.
 */
export function compareVersions(actual: string, minimum: string): boolean {
  const aParts = actual.split(".").map(Number);
  const mParts = minimum.split(".").map(Number);
  const len = Math.max(aParts.length, mParts.length);

  for (let i = 0; i < len; i++) {
    const a = aParts[i] ?? 0;
    const m = mParts[i] ?? 0;
    if (a > m) return true;
    if (a < m) return false;
  }
  return true; // equal
}

async function checkTool(tool: ToolDef): Promise<ToolchainCheck> {
  try {
    const result = await capture([tool.cmd, ...tool.args]);

    if (result.exitCode !== 0) {
      return {
        name: tool.name,
        cmd: tool.cmd,
        passed: false,
        required: tool.required,
        minVersion: tool.minVersion,
        message: `${tool.name} not found${tool.required ? " (required)" : " (optional)"}`,
      };
    }

    const version = tool.versionExtract(result.stdout, result.stderr);

    if (tool.minVersion && version) {
      const meetsMin = compareVersions(version, tool.minVersion);
      return {
        name: tool.name,
        cmd: tool.cmd,
        passed: meetsMin,
        required: tool.required,
        version,
        minVersion: tool.minVersion,
        message: meetsMin
          ? `${tool.name} ${version}`
          : `${tool.name} ${version} (>= ${tool.minVersion} required)`,
      };
    }

    return {
      name: tool.name,
      cmd: tool.cmd,
      passed: true,
      required: tool.required,
      version: version || undefined,
      minVersion: tool.minVersion,
      message: `${tool.name}${version ? ` ${version}` : ""}`,
    };
  } catch {
    return {
      name: tool.name,
      cmd: tool.cmd,
      passed: false,
      required: tool.required,
      minVersion: tool.minVersion,
      message: `${tool.name} not found${tool.required ? " (required)" : " (optional)"}`,
    };
  }
}

/** Run all toolchain checks in parallel. */
export async function runToolchainChecks(): Promise<ToolchainResult> {
  const checks = await Promise.all(WORKBENCH_TOOLS.map(checkTool));
  const passed = checks.filter((c) => c.required).every((c) => c.passed);
  return { passed, checks };
}

/** Get the install command for a tool on the current platform. */
export function getInstallCommand(toolName: string): string | null {
  const platform = process.platform as Platform;
  const tool = WORKBENCH_TOOLS.find((t) => t.name === toolName);
  return tool?.install?.[platform] ?? null;
}

/** Get install commands for all missing tools on the current platform. */
export function getMissingToolInstallCommands(checks: ToolchainCheck[]): Array<{ name: string; command: string }> {
  const platform = process.platform as Platform;
  const results: Array<{ name: string; command: string }> = [];
  for (const check of checks) {
    if (check.passed) continue;
    const tool = WORKBENCH_TOOLS.find((t) => t.name === check.name);
    const cmd = tool?.install?.[platform];
    if (cmd) results.push({ name: check.name, command: cmd });
  }
  return results;
}

/** Attempt to install a tool using the platform-specific command. */
export async function installTool(toolName: string): Promise<boolean> {
  const cmd = getInstallCommand(toolName);
  if (!cmd) return false;
  try {
    const result = await capture(["sh", "-c", cmd]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Ensure a tool is available, attempting installation if missing.
 * Throws with manual install instructions if all else fails.
 */
export async function ensureTool(toolName: string): Promise<void> {
  const tool = WORKBENCH_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);

  // Check if already available
  const check = await checkTool(tool);
  if (check.passed) return;

  // Try to install
  const platform = process.platform as Platform;
  const installCmd = tool.install?.[platform];

  if (installCmd) {
    console.log(`${toolName} not found. Installing: ${installCmd}`);
    const result = await capture(["sh", "-c", installCmd]);
    if (result.exitCode === 0) {
      // Verify installation
      const recheck = await checkTool(tool);
      if (recheck.passed) {
        console.log(`${toolName} installed successfully.`);
        return;
      }
    }
  }

  // Build multi-platform instructions
  const lines = [`${toolName} is required but could not be installed automatically.`];
  if (tool.install?.darwin) lines.push(`  macOS:   ${tool.install.darwin}`);
  if (tool.install?.linux) lines.push(`  Linux:   ${tool.install.linux}`);
  if (tool.install?.win32) lines.push(`  Windows: ${tool.install.win32}`);
  throw new Error(lines.join("\n"));
}
