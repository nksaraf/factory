import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { findPkgRoot } from "../handlers/pkg/detect.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("pkg", [
  "$ dx pkg list                      List linked packages",
  "$ dx pkg link ./my-package         Link local package",
  "$ dx pkg remove ./my-package       Remove a linked package",
  "$ dx pkg diff                      Show package changes",
  "$ dx pkg push                      Push package upstream",
  "$ dx pkg auth --key-file key.pem   Set registry auth key",
]);

/** Resolve the dx project root (walks up from cwd to find .dx/). */
const root = (): string => findPkgRoot(process.cwd());

/** Inject global registry auth keys into process.env for all pkg subcommands. */
async function ensurePkgEnv(): Promise<void> {
  const { loadGlobalAuthEnv } = await import(
    "../handlers/pkg/registry-auth-store.js"
  );
  await loadGlobalAuthEnv();
}

export function pkgCommand(app: DxBase) {
  return app
    .sub("pkg")
    .meta({ description: "Package development workflow" })

    // ── link ──
    .command("link", (c) =>
      c
        .meta({ description: "Check out an external package for local dev" })
        .args([
          {
            name: "source",
            type: "string",
            required: true,
            description: "Git URL or GitHub shorthand (org/repo)",
          },
        ])
        .flags({
          path: {
            type: "string",
            description: "Subdirectory within a monorepo",
          },
          as: {
            type: "string",
            description: "Override package name",
          },
          ref: {
            type: "string",
            description: "Branch or tag to check out",
          },
          branch: {
            type: "string",
            description: "Working branch name (default: dx/<name>-dev)",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgLink } = await import("../handlers/pkg/link.js");
            await pkgLink(root(), {
              source: args.source as string,
              path: flags.path as string | undefined,
              as: flags.as as string | undefined,
              ref: flags.ref as string | undefined,
              branch: flags.branch as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── unlink ──
    .command("unlink", (c) =>
      c
        .meta({ description: "Remove local checkout, restore normal deps" })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package to unlink",
          },
        ])
        .flags({
          force: {
            type: "boolean",
            description: "Force removal even with uncommitted changes",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgUnlink } = await import("../handlers/pkg/unlink.js");
            await pkgUnlink(root(), {
              package: args.package as string,
              force: flags.force as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── remove ──
    .command("remove", (c) =>
      c
        .meta({ description: "Permanently delete a package from the workspace" })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package to remove",
          },
        ])
        .flags({
          yes: {
            type: "boolean",
            short: "y",
            description: "Skip confirmation prompt",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const { pkgRemove } = await import("../handlers/pkg/remove.js");
            await pkgRemove(root(), {
              package: args.package as string,
              yes: flags.yes as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── list ──
    .command("list", (c) =>
      c.meta({ description: "Show linked and contributed packages" }).run(
        async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgList } = await import("../handlers/pkg/list.js");
            await pkgList(root(), f.json);
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }
      )
    )

    // ── diff ──
    .command("diff", (c) =>
      c
        .meta({ description: "Show changes in a linked package" })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package to diff",
          },
        ])
        .flags({
          stat: {
            type: "boolean",
            description: "Show diffstat summary only",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgDiff } = await import("../handlers/pkg/diff.js");
            await pkgDiff(root(), {
              package: args.package as string,
              stat: flags.stat as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── branch ──
    .command("branch", (c) =>
      c
        .meta({
          description: "List, switch, or create branches for a linked package",
        })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package name",
          },
        ])
        .flags({
          switch: {
            type: "string",
            short: "s",
            description: "Switch to an existing branch",
          },
          create: {
            type: "string",
            short: "c",
            description: "Create and switch to a new branch",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgBranch } = await import("../handlers/pkg/branch.js");
            await pkgBranch(root(), {
              package: args.package as string,
              switch: flags.switch as string | undefined,
              create: flags.create as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── push ──
    .command("push", (c) =>
      c
        .meta({
          description: "Commit, push, and create PR for package changes",
        })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package to push",
          },
        ])
        .flags({
          branch: {
            type: "string",
            description: "Override working branch",
          },
          message: {
            type: "string",
            short: "m",
            description: "Custom commit message",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgPush } = await import("../handlers/pkg/push.js");
            await pkgPush(root(), {
              package: args.package as string,
              branch: flags.branch as string | undefined,
              message: flags.message as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── pull ──
    .command("pull", (c) =>
      c
        .meta({
          description: "Pull upstream changes for a linked or contributed package",
        })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package to pull updates for",
          },
        ])
        .flags({
          branch: {
            type: "string",
            description: "Override working branch",
          },
          dryRun: {
            type: "boolean",
            description: "Preview changes without applying",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgPull } = await import("../handlers/pkg/pull.js");
            await pkgPull(root(), {
              package: args.package as string,
              branch: flags.branch as string | undefined,
              dryRun: flags.dryRun as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── contribute ──
    .command("contribute", (c) =>
      c
        .meta({ description: "Contribute a local package to an external repo" })
        .args([
          {
            name: "localPath",
            type: "string",
            required: true,
            description: "Local package (e.g., ui-next or packages/npm/ui-next)",
          },
          {
            name: "target",
            type: "string",
            description: "Target repo (GitHub shorthand or URL)",
          },
        ])
        .flags({
          to: {
            type: "string",
            description: "Target alias from .dx/config.json",
          },
          path: {
            type: "string",
            description: "Target path within destination repo",
          },
          as: {
            type: "string",
            description: "Override package name",
          },
          ref: {
            type: "string",
            description: "Base branch in target repo",
          },
          branch: {
            type: "string",
            description: "Working branch name",
          },
          dryRun: {
            type: "boolean",
            description: "Preview without making changes",
          },
          yes: {
            type: "boolean",
            short: "y",
            description: "Skip confirmation",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgContribute } = await import(
              "../handlers/pkg/contribute.js"
            );
            await pkgContribute(root(), {
              localPath: args.localPath as string,
              target: args.target as string | undefined,
              to: flags.to as string | undefined,
              path: flags.path as string | undefined,
              as: flags.as as string | undefined,
              ref: flags.ref as string | undefined,
              branch: flags.branch as string | undefined,
              dryRun: flags.dryRun as boolean | undefined,
              yes: flags.yes as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── bump ──
    .command("bump", (c) =>
      c
        .meta({ description: "Bump package version" })
        .args([
          {
            name: "package",
            type: "string",
            required: true,
            description: "Package to bump",
          },
        ])
        .flags({
          major: { type: "boolean", description: "Bump major version" },
          minor: { type: "boolean", description: "Bump minor version" },
          patch: { type: "boolean", description: "Bump patch version" },
          dryRun: { type: "boolean", description: "Dry run" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgBump } = await import("../handlers/pkg/bump.js");
            const level = flags.major
              ? "major"
              : flags.minor
                ? "minor"
                : "patch";
            await pkgBump(root(), {
              package: args.package as string,
              level: level as "major" | "minor" | "patch",
              dryRun: flags.dryRun as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── versions ──
    .command("versions", (c) =>
      c
        .meta({ description: "Show local vs latest version comparison" })
        .args([
          {
            name: "target",
            type: "string",
            description: "Specific package target",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgVersions } = await import(
              "../handlers/pkg/versions.js"
            );
            await pkgVersions(root(), {
              target: args.target as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── auth ──
    .command("auth", (c) =>
      c
        .meta({ description: "Configure registry credentials" })
        .flags({
          check: {
            type: "boolean",
            description: "Check credentials only",
          },
          keyFile: {
            type: "string",
            description: "Service account key file",
          },
          key: {
            type: "string",
            description: "Base64-encoded service account key",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgAuth } = await import("../handlers/pkg/auth.js");
            await pkgAuth(root(), {
              check: flags.check as boolean | undefined,
              keyFile: flags.keyFile as string | undefined,
              key: flags.key as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── publish ──
    .command("publish", (c) =>
      c
        .meta({ description: "Publish package to registry" })
        .args([
          {
            name: "target",
            type: "string",
            required: true,
            description: "Package to publish",
          },
        ])
        .flags({
          dryRun: { type: "boolean", description: "Dry run" },
          keyFile: {
            type: "string",
            description: "Service account key file",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            await ensurePkgEnv();
            const { pkgPublish } = await import(
              "../handlers/pkg/publish.js"
            );
            await pkgPublish(root(), {
              target: args.target as string,
              dryRun: flags.dryRun as boolean | undefined,
              keyFile: flags.keyFile as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── doctor ──
    .command("doctor", (c) =>
      c
        .meta({ description: "Run workspace health checks" })
        .flags({
          fix: {
            type: "boolean",
            description: "Auto-fix safe issues",
          },
          category: {
            type: "string",
            description: "Run a single check category",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { pkgDoctor } = await import("../handlers/pkg/doctor.js");
            await pkgDoctor(root(), {
              fix: flags.fix as boolean | undefined,
              category: flags.category as string | undefined,
              json: f.json,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── install ──
    .command("install", (c) =>
      c
        .meta({ description: "Install dependencies across workspace" })
        .flags({
          frozen: {
            type: "boolean",
            description: "Use frozen lockfile (CI mode)",
          },
          filter: {
            type: "string",
            description: "Filter to specific packages (glob or name)",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { pkgInstall } = await import(
              "../handlers/pkg/install-workspace.js"
            );
            await pkgInstall(root(), {
              frozen: flags.frozen as boolean | undefined,
              filter: flags.filter as string | undefined,
              json: f.json,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── run ──
    .command("run", (c) =>
      c
        .meta({ description: "Run scripts across workspace packages" })
        .args([
          {
            name: "script",
            type: "string",
            required: true,
            description: "Script name to run",
          },
        ])
        .flags({
          filter: {
            type: "string",
            description: "Filter to specific packages (glob or name)",
          },
          parallel: {
            type: "boolean",
            description: "Run scripts in parallel",
          },
          continueOnError: {
            type: "boolean",
            description: "Continue running even if a script fails",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const { pkgRunScript } = await import(
              "../handlers/pkg/run-script.js"
            );
            await pkgRunScript(root(), {
              script: args.script as string,
              filter: flags.filter as string | undefined,
              parallel: flags.parallel as boolean | undefined,
              continueOnError: flags.continueOnError as boolean | undefined,
              json: f.json,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── deps ──
    .command("deps", (c) =>
      c
        .meta({ description: "Show workspace dependency graph" })
        .flags({
          why: {
            type: "string",
            description: "Show why a package is depended on",
          },
          external: {
            type: "boolean",
            description: "Show external (non-workspace) dependencies",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { pkgDeps } = await import("../handlers/pkg/deps.js");
            await pkgDeps(root(), {
              why: flags.why as string | undefined,
              external: flags.external as boolean | undefined,
              json: f.json,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── update ──
    .command("update", (c) =>
      c
        .meta({ description: "Update dependencies across workspace" })
        .args([
          {
            name: "dep",
            type: "string",
            description: "Specific dependency to update",
          },
        ])
        .flags({
          latest: {
            type: "boolean",
            description: "Update to latest versions (ignore ranges)",
          },
          dryRun: {
            type: "boolean",
            description: "Show what would change without applying",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const { pkgUpdate } = await import("../handlers/pkg/update.js");
            await pkgUpdate(root(), {
              dep: args.dep as string | undefined,
              latest: flags.latest as boolean | undefined,
              dryRun: flags.dryRun as boolean | undefined,
              json: f.json,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    );
}
