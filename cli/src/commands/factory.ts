import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { setExamples } from "../plugins/examples-plugin.js";

import { toDxFlags } from "./dx-flags.js";
import { stubRun } from "./stub-run.js";

setExamples("factory", [
  "$ dx factory status                Factory API and service status",
  "$ dx factory health                Deep health check",
  "$ dx factory connect <url>         Point CLI at a factory instance",
  "$ dx factory config                View factory configuration",
  "$ dx factory auth login            Sign in to factory",
  "$ dx factory install               Install the factory platform",
]);

export function factoryCommand(app: DxBase) {
  return app
    .sub("factory")
    .meta({ description: "Factory platform operations" })

    // ── status ──
    .command("status", (c) =>
      c
        .meta({ description: "Factory API health, repo, and PR status" })
        .run(async ({ flags }) => {
          const { runFactoryStatus } = await import("../handlers/factory-status.js");
          await runFactoryStatus(toDxFlags(flags));
        })
    )

    // ── health ──
    .command("health", (c) =>
      c
        .meta({ description: "Deep health check of factory services" })
        .run(async ({ flags }) => {
          const { runFactoryHealth } = await import("../handlers/factory-health.js");
          await runFactoryHealth(toDxFlags(flags));
        })
    )

    // ── connect ──
    .command("connect", (c) =>
      c
        .meta({ description: "Point CLI at a factory instance" })
        .args([
          {
            name: "url",
            type: "string",
            description: "Factory URL (e.g. https://factory.example.com)",
          },
        ])
        .run(async ({ args, flags }) => {
          const { runFactoryConnect } = await import("../handlers/factory-connect.js");
          await runFactoryConnect(toDxFlags(flags), {
            url: args.url as string | undefined,
          });
        })
    )

    // ── config ──
    .command("config", (c) =>
      c
        .meta({ description: "View factory configuration" })
        .run(async ({ flags }) => {
          const { runFactoryConfig } = await import("../handlers/factory-config.js");
          await runFactoryConfig(toDxFlags(flags));
        })
    )

    // ── auth ──
    .command("auth", (c) =>
      c
        .meta({ description: "Factory authentication" })
        .command("login", (sub) =>
          sub
            .meta({ description: "Sign in with email and password" })
            .flags({
              email: {
                type: "string",
                short: "e",
                description: "Account email",
              },
              password: {
                type: "string",
                description: "Password (visible in shell history; omit for a hidden TTY prompt)",
              },
            })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags);
              const { runAuthLogin } = await import("../handlers/auth-login.js");
              await runAuthLogin(f, {
                email: f.email as string | undefined,
                password: f.password as string | undefined,
              });
            })
        )
        .command("logout", (sub) =>
          sub
            .meta({ description: "Sign out and remove local session" })
            .run(async ({ flags }) => {
              const { runAuthLogout } = await import("../handlers/auth-logout.js");
              await runAuthLogout(toDxFlags(flags));
            })
        )
        .command("whoami", (sub) =>
          sub
            .meta({ description: "Print the current signed-in user" })
            .run(async ({ flags }) => {
              const { runWhoami } = await import("../handlers/whoami.js");
              await runWhoami(toDxFlags(flags));
            })
        )
    )

    // ── install ──
    .command("install", (c) =>
      c
        .meta({ description: "Install the factory platform on this node" })
        .flags({
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
          force: { type: "boolean", description: "Force install over existing installation" },
          fresh: { type: "boolean", description: "Ignore saved install progress and start from phase 1" },
          kubeconfig: { type: "string", short: "k", description: "Path to kubeconfig for a remote cluster" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            // Re-use the install handler but force the factory role
            const { spawnSync } = await import("node:child_process");
            const args = ["install", "--role", "factory"];
            if (flags.bundle) args.push("--bundle", flags.bundle as string);
            if (flags.force) args.push("--force");
            if (flags.fresh) args.push("--fresh");
            if (flags.kubeconfig) args.push("--kubeconfig", flags.kubeconfig as string);
            if (f.json) args.push("--json");
            if (f.verbose) args.push("--verbose");
            if (f.debug) args.push("--debug");

            const result = spawnSync(process.argv[0], [process.argv[1], ...args], {
              stdio: "inherit",
              env: process.env,
            });
            process.exit(result.status ?? 1);
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── upgrade ──
    .command("upgrade", (c) =>
      c
        .meta({ description: "Upgrade an existing factory installation" })
        .flags({
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
          version: { type: "string", description: "Target version" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { spawnSync } = await import("node:child_process");
            const args = ["install", "upgrade"];
            if (flags.bundle) args.push("--bundle", flags.bundle as string);
            if (flags.version) args.push("--version", flags.version as string);
            if (f.verbose) args.push("--verbose");
            if (f.json) args.push("--json");
            if (f.debug) args.push("--debug");

            const result = spawnSync(process.argv[0], [process.argv[1], ...args], {
              stdio: "inherit",
              env: process.env,
            });
            process.exit(result.status ?? 1);
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── uninstall ──
    .command("uninstall", (c) =>
      c
        .meta({ description: "Tear down the factory platform" })
        .flags({
          keepK3s: { type: "boolean", description: "Keep k3s installed (only remove dx-platform)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { spawnSync } = await import("node:child_process");
            const args = ["install", "uninstall"];
            if (flags.keepK3s) args.push("--keepK3s");
            if (f.verbose) args.push("--verbose");
            if (f.json) args.push("--json");
            if (f.debug) args.push("--debug");

            const result = spawnSync(process.argv[0], [process.argv[1], ...args], {
              stdio: "inherit",
              env: process.env,
            });
            process.exit(result.status ?? 1);
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    )

    // ── logs ──
    .command("logs", (c) =>
      c
        .meta({ description: "Factory platform logs" })
        .run(stubRun)
    )

    // ── events ──
    .command("events", (c) =>
      c
        .meta({ description: "Factory audit log and platform events" })
        .run(stubRun)
    );
}
