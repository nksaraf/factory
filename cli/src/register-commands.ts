// ─── Active commands ────────────────────────────────────────
import { addCommand } from "./commands/add.js"
import { agentCommand } from "./commands/agent.js"
import { alertCommand } from "./commands/alert.js"
import { artifactCommand } from "./commands/artifact.js"
import { buildCommand } from "./commands/build.js"
import { catalogCommand } from "./commands/catalog.js"
import { checkCommand } from "./commands/check.js"
import { ciCommand } from "./commands/ci.js"
import { clusterCommand } from "./commands/cluster.js"
import { configCommand } from "./commands/config.js"
import { contextCommand } from "./commands/context.js"
import { customerCommand } from "./commands/customer.js"
import { dbCommand } from "./commands/db.js"
import { deployCommand } from "./commands/deploy.js"
import { devCommand } from "./commands/dev.js"
import { dockerCommand } from "./commands/docker.js"
import { doctorCommand } from "./commands/doctor.js"
import { domainCommand } from "./commands/domain.js"
import { downCommand } from "./commands/down.js"
import { entitlementCommand } from "./commands/entitlement.js"
import { envCommand } from "./commands/env.js"
import { execCommand } from "./commands/exec.js"
import { factoryCommand } from "./commands/factory.js"
import { fleetCommand } from "./commands/fleet.js"
// ─── New commands (dx CLI redesign) ─────────────────────────
import { formatCommand } from "./commands/format.js"
import { forwardCommand } from "./commands/forward.js"
import { generateCommand } from "./commands/generate.js"
import { gitHookCommand } from "./commands/git-hook.js"
import { gitCommand } from "./commands/git.js"
import { infraCommand } from "./commands/infra.js"
import { initCommand } from "./commands/init.js"
import { kubeCommand } from "./commands/kube.js"
import { lintCommand } from "./commands/lint.js"
import { logsCommand } from "./commands/logs.js"
import { metricsCommand } from "./commands/metrics.js"
import { moduleCommand } from "./commands/module.js"
import { openCommand } from "./commands/open.js"
import { opsCommand } from "./commands/ops.js"
import { orgCommand } from "./commands/org.js"
import { pkgCommand } from "./commands/pkg.js"
import { planCommand } from "./commands/plan.js"
import { previewCommand } from "./commands/preview.js"
import { psCommand } from "./commands/ps.js"
import { releaseCommand } from "./commands/release.js"
import { routeCommand } from "./commands/route.js"
import { runCommand } from "./commands/run.js"
import { scanCommand } from "./commands/scan.js"
import { scriptCommand } from "./commands/script.js"
import { secretCommand } from "./commands/secret.js"
import { selfUpdateCommand } from "./commands/self-update.js"
import { setupCommand } from "./commands/setup.js"
import { siteCommand } from "./commands/site.js"
import { sshCommand } from "./commands/ssh.js"
import { statusCommand } from "./commands/status.js"
import { syncCommand } from "./commands/sync.js"
import { tenantCommand } from "./commands/tenant.js"
import { testCommand } from "./commands/test.js"
import { traceCommand } from "./commands/trace.js"
import { tuiCommand } from "./commands/tui.js"
import { tunnelCommand } from "./commands/tunnel.js"
import { typecheckCommand } from "./commands/typecheck.js"
import { upCommand } from "./commands/up.js"
import { upgradeCommand } from "./commands/upgrade.js"
import { varCommand } from "./commands/var.js"
import { whoamiCommand } from "./commands/whoami.js"
import { workCommand } from "./commands/work.js"
import { workflowCommand } from "./commands/workflow.js"
import { workspaceCommand } from "./commands/workspace.js"
import type { DxBase } from "./dx-root.js"

/**
 * Attach all top-level commands built with {@link DxBase.sub} (Crust file-splitting pattern).
 * @see https://crustjs.com/docs/guide/subcommands#file-splitting-pattern
 */
export function registerCommands(app: DxBase): DxBase {
  return (
    app
      // ── Setup ───────────────────────────────────────────
      .command(setupCommand(app))
      .command(selfUpdateCommand(app))

      // ── Project lifecycle ───────────────────────────────
      .command(initCommand(app))
      .command(upgradeCommand(app))
      .command(syncCommand(app))
      .command(doctorCommand(app))

      // ── Development ─────────────────────────────────────
      .command(devCommand(app))
      .command(upCommand(app))
      .command(downCommand(app))
      .command(psCommand(app))
      .command(statusCommand(app))
      .command(logsCommand(app))

      // ── Quality ─────────────────────────────────────────
      .command(checkCommand(app))
      .command(lintCommand(app))
      .command(typecheckCommand(app))
      .command(testCommand(app))
      .command(formatCommand(app))
      .command(generateCommand(app))

      // ── Database ────────────────────────────────────────
      .command(dbCommand(app))

      // ── Deploy ──────────────────────────────────────────
      .command(envCommand(app))
      .command(deployCommand(app))
      .command(releaseCommand(app))
      .command(secretCommand(app))
      .command(varCommand(app))
      .command(previewCommand(app))

      // ── Infrastructure ──────────────────────────────────
      .command(tunnelCommand(app))
      .command(forwardCommand(app))
      .command(infraCommand(app))
      .command(clusterCommand(app))
      .command(kubeCommand(app))
      .command(workspaceCommand(app))
      .command(openCommand(app))
      .command(siteCommand(app))

      // ── Platform ────────────────────────────────────────
      .command(addCommand(app))
      .command(agentCommand(app))
      .command(alertCommand(app))
      .command(artifactCommand(app))
      .command(buildCommand(app))
      .command(catalogCommand(app))
      .command(ciCommand(app))
      .command(configCommand(app))
      .command(contextCommand(app))
      .command(customerCommand(app))
      .command(dockerCommand(app))
      .command(domainCommand(app))
      .command(entitlementCommand(app))
      .command(execCommand(app))
      .command(factoryCommand(app))
      .command(fleetCommand(app))
      .command(gitCommand(app))
      .command(scanCommand(app))
      .command(metricsCommand(app))
      .command(moduleCommand(app))
      .command(opsCommand(app))
      .command(orgCommand(app))
      .command(pkgCommand(app))
      .command(planCommand(app))
      .command(routeCommand(app))
      .command(runCommand(app))
      .command(scriptCommand(app))
      .command(sshCommand(app))
      .command(tenantCommand(app))
      .command(traceCommand(app))
      .command(tuiCommand(app))
      .command(whoamiCommand(app))
      .command(workCommand(app))
      .command(workflowCommand(app))

      // ── Internal (not shown in help) ────────────────────
      .command(gitHookCommand(app))
  )
}
