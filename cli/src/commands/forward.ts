import { spawn } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { EntityFinder } from "../lib/entity-finder.js";
import { buildSshArgs, clearStaleHostKey } from "../lib/ssh-utils.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { stubRun } from "./stub-run.js";
import { styleBold, styleMuted, styleSuccess, styleError } from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("forward", [
  "$ dx forward staging:5432              Forward remote port to localhost",
  "$ dx forward staging:5432 --as 5433    Bind to different local port",
  "$ dx forward prod-1:3000               Forward production API port",
  "$ dx forward list                      List active forwards",
]);

export function forwardCommand(app: DxBase) {
  return app
    .sub("forward")
    .meta({ description: "Forward remote ports to localhost (SSH port forwarding)" })

    // dx forward <host:port> — open an SSH -L forward
    .args([
      {
        name: "target",
        type: "string",
        description: "Remote target as host:port (e.g. staging:5432)",
      },
    ])
    .flags({
      as: {
        type: "number",
        description: "Local port to bind (default: same as remote port)",
      },
      user: {
        type: "string",
        short: "l",
        description: "SSH user override",
      },
      identity: {
        type: "string",
        short: "i",
        description: "Path to SSH identity file",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const target = args.target as string | undefined;

      if (!target || !target.includes(":")) {
        exitWithError(f, "Usage: dx forward <host>:<port>\n  Example: dx forward staging:5432");
      }

      const colonIdx = target.lastIndexOf(":");
      const hostPart = target.slice(0, colonIdx);
      const remotePort = parseInt(target.slice(colonIdx + 1), 10);

      if (!hostPart || isNaN(remotePort) || remotePort <= 0 || remotePort > 65535) {
        exitWithError(f, `Invalid target "${target}". Expected format: host:port (e.g. staging:5432)`);
      }

      const localPort = (flags.as as number) ?? remotePort;

      // Resolve host through EntityFinder (Factory API → SSH config → local)
      let sshHost = hostPart;
      let sshPort = 22;
      let sshUser = (flags.user as string) ?? undefined;
      let identityFile = (flags.identity as string) ?? undefined;
      let jumpHost: string | undefined;
      let jumpUser: string | undefined;
      let jumpPort: number | undefined;
      let displayName = hostPart;

      try {
        const finder = new EntityFinder();
        const entity = await finder.resolve(hostPart);
        if (entity?.sshHost) {
          sshHost = entity.sshHost;
          sshPort = entity.sshPort ?? 22;
          sshUser = sshUser ?? entity.sshUser ?? undefined;
          identityFile = identityFile ?? entity.identityFile ?? undefined;
          jumpHost = entity.jumpHost;
          jumpUser = entity.jumpUser;
          jumpPort = entity.jumpPort;
          displayName = entity.displayName ?? hostPart;
        }
      } catch {
        // EntityFinder unavailable (no Factory connection) — use raw hostname
      }

      clearStaleHostKey(sshHost, sshPort);

      // Build SSH args: -N (no remote command) + -L (local forward)
      const sshArgs = buildSshArgs({
        host: sshHost,
        port: sshPort,
        user: sshUser,
        identity: identityFile,
        tty: "none",
        hostKeyCheck: "accept-new",
        jumpHost,
        jumpUser,
        jumpPort,
      });

      // Prepend -N and -L before the user@host arg
      const forwardSpec = `${localPort}:localhost:${remotePort}`;
      const hostArgIdx = sshArgs.length - 1; // user@host is always last
      sshArgs.splice(hostArgIdx, 0, "-N", "-L", forwardSpec);

      if (f.json) {
        console.log(JSON.stringify({
          success: true,
          data: {
            remote: { host: displayName, port: remotePort },
            local: { port: localPort },
            sshHost,
            sshPort,
          },
        }, null, 2));
      } else {
        console.log("");
        console.log(`  ${styleSuccess("Forward open.")}`);
        console.log(`  Remote: ${styleBold(displayName)}:${remotePort}`);
        console.log(`  Local:  ${styleBold(`localhost:${localPort}`)}`);
        console.log("");
        console.log(styleMuted("  Press Ctrl+C to close."));
        console.log("");
      }

      // Spawn SSH and handle graceful shutdown
      const child = spawn("ssh", sshArgs, { stdio: "inherit" });

      const shutdown = () => {
        child.kill("SIGTERM");
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await new Promise<void>((resolve) => {
        child.on("close", (code) => {
          process.off("SIGINT", shutdown);
          process.off("SIGTERM", shutdown);
          if (code === 0 || code === null) {
            if (!f.json) {
              console.log(styleMuted("\n  Forward closed."));
            }
          } else {
            if (!f.json) {
              console.error(styleError(`  SSH exited with code ${code}`));
            }
          }
          process.exit(code ?? 0);
        });
      });
    })

    // dx forward list — list active forwards (stub)
    .command("list", (c) =>
      c
        .meta({ description: "List active port forwards" })
        .run(stubRun)
    )

    // dx forward close — close forwards (stub)
    .command("close", (c) =>
      c
        .meta({ description: "Close port forwards" })
        .args([
          {
            name: "id",
            type: "string",
            description: "Forward ID to close (omit for interactive)",
          },
        ])
        .flags({
          all: { type: "boolean", description: "Close all active forwards" },
        })
        .run(stubRun)
    );
}
