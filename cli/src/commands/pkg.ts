import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";

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
            await pkgLink(process.cwd(), {
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
            await pkgUnlink(process.cwd(), {
              package: args.package as string,
              force: flags.force as boolean | undefined,
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
            await pkgList(process.cwd(), f.json);
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
            await pkgDiff(process.cwd(), {
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
            await pkgBranch(process.cwd(), {
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
            await pkgPush(process.cwd(), {
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
            await pkgPull(process.cwd(), {
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
            await pkgContribute(process.cwd(), {
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
            await pkgBump(process.cwd(), {
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
            await pkgVersions(process.cwd(), {
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
            await pkgAuth(process.cwd(), {
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
            await pkgPublish(process.cwd(), {
              target: args.target as string,
              dryRun: flags.dryRun as boolean | undefined,
              keyFile: flags.keyFile as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    );
}
