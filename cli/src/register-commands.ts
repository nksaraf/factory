import type { DxBase } from "./dx-root.js";

import { addCommand } from "./commands/add.js";
import { agentCommand } from "./commands/agent.js";
import { alertCommand } from "./commands/alert.js";
import { artifactCommand } from "./commands/artifact.js";
import { authCommand } from "./commands/auth.js";
import { branchCommand } from "./commands/branch.js";
import { buildCommand } from "./commands/build.js";
import { checkCommand } from "./commands/check.js";
import { ciCommand } from "./commands/ci.js";
import { commitCommand } from "./commands/commit.js";
import { configCommand } from "./commands/config.js";
import { connectCommand } from "./commands/connect.js";
import { contextCommand } from "./commands/context.js";
import { catalogCommand } from "./commands/catalog.js";
import { clusterCommand } from "./commands/cluster.js";
import { customerCommand } from "./commands/customer.js";
import { dbCommand } from "./commands/db.js";
import { deployCommand } from "./commands/deploy.js";
import { dockerCommand } from "./commands/docker.js";
import { doctorCommand } from "./commands/doctor.js";
import { domainCommand } from "./commands/domain.js";
import { devCommand } from "./commands/dev.js";
import { downCommand } from "./commands/down.js";
import { entitlementCommand } from "./commands/entitlement.js";
import { envCommand } from "./commands/env.js";
import { factoryCommand } from "./commands/factory.js";
import { gitCommand } from "./commands/git.js";
import { infraCommand } from "./commands/infra.js";
import { installCommand } from "./commands/install.js";
import { kubeCommand } from "./commands/kube.js";
import { initCommand } from "./commands/init.js";
import { logsCommand } from "./commands/logs.js";
import { metricsCommand } from "./commands/metrics.js";
import { moduleCommand } from "./commands/module.js";
import { opsCommand } from "./commands/ops.js";
import { pkgCommand } from "./commands/pkg.js";
import { planCommand } from "./commands/plan.js";
import { previewCommand } from "./commands/preview.js";
import { prCommand } from "./commands/pr.js";
import { pushCommand } from "./commands/push.js";
import { releaseCommand } from "./commands/release.js";
import { routeCommand } from "./commands/route.js";
import { sandboxCommand } from "./commands/sandbox.js";
import { scriptCommand } from "./commands/script.js";
import { secretCommand } from "./commands/secret.js";
import { setupCommand } from "./commands/setup.js";
import { sshCommand } from "./commands/ssh.js";
import { shipCommand } from "./commands/ship.js";
import { siteCommand } from "./commands/site.js";
import { statusCommand } from "./commands/status.js";
import { tenantCommand } from "./commands/tenant.js";
import { testCommand } from "./commands/test.js";
import { traceCommand } from "./commands/trace.js";
import { tunnelCommand } from "./commands/tunnel.js";
import { upCommand } from "./commands/up.js";
import { whoamiCommand } from "./commands/whoami.js";
import { workCommand } from "./commands/work.js";
import { worktreeCommand } from "./commands/worktree.js";

/**
 * Attach all top-level commands built with {@link DxBase.sub} (Crust file-splitting pattern).
 * @see https://crustjs.com/docs/guide/subcommands#file-splitting-pattern
 */
export function registerCommands(app: DxBase): DxBase {
  return app
    .command(addCommand(app))
    .command(agentCommand(app))
    .command(alertCommand(app))
    .command(artifactCommand(app))
    .command(authCommand(app))
    .command(branchCommand(app))
    .command(buildCommand(app))
    .command(catalogCommand(app))
    .command(checkCommand(app))
    .command(clusterCommand(app))
    .command(ciCommand(app))
    .command(commitCommand(app))
    .command(configCommand(app))
    .command(connectCommand(app))
    .command(contextCommand(app))
    .command(customerCommand(app))
    .command(dbCommand(app))
    .command(deployCommand(app))
    .command(dockerCommand(app))
    .command(devCommand(app))
    .command(doctorCommand(app))
    .command(domainCommand(app))
    .command(downCommand(app))
    .command(entitlementCommand(app))
    .command(envCommand(app))
    .command(factoryCommand(app))
    .command(gitCommand(app))
    .command(infraCommand(app))
    .command(installCommand(app))
    .command(initCommand(app))
    .command(kubeCommand(app))
    .command(logsCommand(app))
    .command(metricsCommand(app))
    .command(moduleCommand(app))
    .command(opsCommand(app))
    .command(pkgCommand(app))
    .command(planCommand(app))
    .command(previewCommand(app))
    .command(prCommand(app))
    .command(pushCommand(app))
    .command(releaseCommand(app))
    .command(routeCommand(app))
    .command(sandboxCommand(app))
    .command(scriptCommand(app))
    .command(secretCommand(app))
    .command(setupCommand(app))
    .command(sshCommand(app))
    .command(shipCommand(app))
    .command(siteCommand(app))
    .command(statusCommand(app))
    .command(tenantCommand(app))
    .command(testCommand(app))
    .command(traceCommand(app))
    .command(tunnelCommand(app))
    .command(upCommand(app))
    .command(whoamiCommand(app))
    .command(workCommand(app))
    .command(worktreeCommand(app));
}
