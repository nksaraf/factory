import type { DxBase } from "./dx-root.js";

import { agentCommand } from "./commands/agent.js";
import { alertCommand } from "./commands/alert.js";
import { authCommand } from "./commands/auth.js";
import { branchCommand } from "./commands/branch.js";
import { buildCommand } from "./commands/build.js";
import { commitCommand } from "./commands/commit.js";
import { connectCommand } from "./commands/connect.js";
import { contextCommand } from "./commands/context.js";
import { customerCommand } from "./commands/customer.js";
import { dbCommand } from "./commands/db.js";
import { deployCommand } from "./commands/deploy.js";
import { domainCommand } from "./commands/domain.js";
import { devCommand } from "./commands/dev.js";
import { entitlementCommand } from "./commands/entitlement.js";
import { envCommand } from "./commands/env.js";
import { gitCommand } from "./commands/git.js";
import { infraCommand } from "./commands/infra.js";
import { installCommand } from "./commands/install.js";
import { initCommand } from "./commands/init.js";
import { logsCommand } from "./commands/logs.js";
import { metricsCommand } from "./commands/metrics.js";
import { moduleCommand } from "./commands/module.js";
import { opsCommand } from "./commands/ops.js";
import { pkgCommand } from "./commands/pkg.js";
import { planCommand } from "./commands/plan.js";
import { pushCommand } from "./commands/push.js";
import { releaseCommand } from "./commands/release.js";
import { routeCommand } from "./commands/route.js";
import { sandboxCommand } from "./commands/sandbox.js";
import { secretCommand } from "./commands/secret.js";
import { siteCommand } from "./commands/site.js";
import { statusCommand } from "./commands/status.js";
import { tenantCommand } from "./commands/tenant.js";
import { testCommand } from "./commands/test.js";
import { traceCommand } from "./commands/trace.js";
import { tunnelCommand } from "./commands/tunnel.js";
import { whoamiCommand } from "./commands/whoami.js";
import { workCommand } from "./commands/work.js";

/**
 * Attach all top-level commands built with {@link DxBase.sub} (Crust file-splitting pattern).
 * @see https://crustjs.com/docs/guide/subcommands#file-splitting-pattern
 */
export function registerCommands(app: DxBase): DxBase {
  return app
    .command(agentCommand(app))
    .command(alertCommand(app))
    .command(authCommand(app))
    .command(branchCommand(app))
    .command(buildCommand(app))
    .command(commitCommand(app))
    .command(connectCommand(app))
    .command(contextCommand(app))
    .command(customerCommand(app))
    .command(dbCommand(app))
    .command(deployCommand(app))
    .command(devCommand(app))
    .command(domainCommand(app))
    .command(entitlementCommand(app))
    .command(envCommand(app))
    .command(gitCommand(app))
    .command(infraCommand(app))
    .command(installCommand(app))
    .command(initCommand(app))
    .command(logsCommand(app))
    .command(metricsCommand(app))
    .command(moduleCommand(app))
    .command(opsCommand(app))
    .command(pkgCommand(app))
    .command(planCommand(app))
    .command(pushCommand(app))
    .command(releaseCommand(app))
    .command(routeCommand(app))
    .command(sandboxCommand(app))
    .command(secretCommand(app))
    .command(siteCommand(app))
    .command(statusCommand(app))
    .command(tenantCommand(app))
    .command(testCommand(app))
    .command(traceCommand(app))
    .command(tunnelCommand(app))
    .command(whoamiCommand(app))
    .command(workCommand(app));
}
