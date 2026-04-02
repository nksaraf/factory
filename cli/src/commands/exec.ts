import { execFileSync } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { getFactoryClient } from "../client.js";
import { EntityFinder } from "../lib/entity-finder.js";
import { buildSshArgs, buildKubectlExecArgs, wrapRemoteCommand } from "../lib/ssh-utils.js";
import { styleError, styleMuted, styleBold } from "../cli-style.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("exec", [
  "$ dx exec my-sandbox -- ls -la           Run command in sandbox",
  "$ dx exec my-vm -- docker ps             Run command on VM via SSH",
  "$ dx exec my-workspace -- /bin/bash      Open shell in workspace",
  "$ dx exec my-vm --dir /app -- make build Run in specific directory",
]);

export function execCommand(app: DxBase) {
  return app
    .sub("exec")
    .meta({ description: "Run a command on a remote machine" })
    .args([
      {
        name: "target",
        type: "string",
        required: true,
        description: "Machine name/slug to exec into",
      },
    ])
    .flags({
      container: {
        type: "string",
        short: "c",
        description: 'Container name (for k8s targets, default: "workspace")',
      },
      context: {
        type: "string",
        description: "kubectl context override",
      },
      dir: {
        type: "string",
        description: "Working directory on remote machine",
      },
      sudo: {
        type: "boolean",
        description: "Run command with sudo",
      },
      user: {
        type: "string",
        short: "l",
        description: "Override SSH user",
      },
    })
    .run(async ({ args, flags }) => {
      // Parse -- separated command
      const dashIdx = process.argv.indexOf("--");
      const cmd = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : ["/bin/bash"];

      // Resolve target
      const finder = new EntityFinder();
      const entity = await finder.resolve(args.target);

      if (!entity) {
        console.error(styleError(`No machine found for "${args.target}".`));
        console.log(styleMuted("\nSearched sandboxes, VMs, and hosts. Try:"));
        console.log(styleMuted("  dx ssh    — interactive picker"));
        process.exit(1);
      }

      if (entity.transport === 'none') {
        console.error(styleError(`"${entity.displayName}" (${entity.type}) does not support exec.`));
        process.exit(1);
      }

      if (entity.transport === 'kubectl') {
        // kubectl exec
        const kubectlArgs = buildKubectlExecArgs({
          podName: entity.podName!,
          namespace: entity.namespace!,
          container: (flags.container as string) ?? entity.container,
          kubeContext: flags.context as string,
          interactive: cmd[0] === '/bin/bash' || cmd[0] === '/bin/sh' || cmd[0] === 'bash' || cmd[0] === 'sh',
        });

        // Add -- separator and command
        const wrappedCmd = wrapRemoteCommand(cmd, {
          dir: flags.dir as string,
          sudo: flags.sudo as boolean,
        });
        kubectlArgs.push("--", ...wrappedCmd);

        try {
          execFileSync("kubectl", kubectlArgs, { stdio: "inherit" });
        } catch (err: any) {
          process.exit(err.status ?? 1);
        }
      } else {
        // SSH exec
        const sshArgs = buildSshArgs({
          host: entity.sshHost!,
          port: entity.sshPort,
          user: (flags.user as string) ?? entity.sshUser,
          tty: 'basic',
          hostKeyCheck: 'none',
          dir: flags.dir as string,
          sudo: flags.sudo as boolean,
        });

        const wrappedCmd = wrapRemoteCommand(cmd, {
          dir: flags.dir as string,
          sudo: flags.sudo as boolean,
        });
        sshArgs.push(...wrappedCmd);

        try {
          execFileSync("ssh", sshArgs, { stdio: "inherit" });
        } catch (err: any) {
          if (err.status != null) process.exit(err.status);
          throw err;
        }
      }
    });
}
