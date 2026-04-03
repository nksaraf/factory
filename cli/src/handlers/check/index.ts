import type { DxFlags } from "../../stub.js";
import { exitWithError } from "../../lib/cli-exit.js";
import { ProjectContext } from "../../lib/project.js";
import type { CheckKind } from "../../lib/quality/types.js";
import { ALL_CHECK_KINDS } from "../../lib/quality/types.js";
import {
  buildComponentContext,
  getStagedFiles,
  runQualityChecks,
} from "../../lib/quality/index.js";
import { printSummary, buildJsonReport, computeExitCode } from "./reporter.js";

export interface CheckHandlerOpts {
  flags: DxFlags & Record<string, unknown>;
  /** Specific check kind, or undefined for all. */
  kind?: CheckKind;
  /** Target a specific component. */
  component?: string;
  /** CI mode — exit code based on block_pr conventions. */
  ci?: boolean;
  /** Only check staged files. */
  staged?: boolean;
  /** Auto-fix where possible. */
  fix?: boolean;
  /** Report format. */
  report?: "summary" | "json";
}

export async function runCheckHandler(opts: CheckHandlerOpts): Promise<void> {
  const { flags, kind, component, ci, staged, fix, report } = opts;

  let project: ProjectContext;
  try {
    project = ProjectContext.fromCwd();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exitWithError(flags, msg, 1, [
      {
        action: "dx init",
        description: "Create a new project with quality tooling",
      },
    ]);
  }

  const quality = project.conventions.quality;
  const kinds = kind ? [kind] : ALL_CHECK_KINDS;

  // Discover components
  const targetNames = component
    ? [component]
    : project.componentNames;

  const stagedFiles = staged ? getStagedFiles(project.rootDir) : undefined;

  const contexts = targetNames
    .map((name) => {
      const comp = project.getComponent(name);
      if (!comp) {
        if (component) {
          exitWithError(flags, `Unknown component "${name}"`);
        }
        return null;
      }
      return buildComponentContext(name, comp, project.rootDir);
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (contexts.length === 0) {
    exitWithError(flags, "No components with detectable runtimes found.", 1, [
      {
        action: "Add dx.runtime label",
        description:
          "Set runtime (node/python/java) on your docker-compose services",
      },
    ]);
  }

  const checkReport = await runQualityChecks(contexts, {
    kinds,
    quality,
    staged,
    fix,
    verbose: flags.verbose,
    stagedFiles,
  });

  const reportFormat = report ?? (flags.json ? "json" : "summary");

  if (reportFormat === "json") {
    console.log(JSON.stringify(buildJsonReport(checkReport), null, 2));
  } else {
    printSummary(checkReport, Boolean(flags.verbose));
  }

  const exitCode = computeExitCode(checkReport, Boolean(ci));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
