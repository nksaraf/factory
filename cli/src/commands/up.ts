import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import type { DxBase } from "../dx-root.js"
import {
  autoConnectsFromDeps,
  coveredSystemsFromConnectFlags,
} from "../lib/auto-connect.js"
import { exitWithError } from "../lib/cli-exit.js"
import {
  COMPOSE_OVERRIDE_FILE,
  cleanupConnectionContext,
} from "../lib/connection-context-file.js"
import { runPrelude } from "../lib/prelude.js"
import { SiteOrchestrator } from "../lib/site-orchestrator.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("up", [
  "$ dx up                  Bring up the site (all containers, prod-like)",
  "$ dx up infra            Bring up a profile",
  "$ dx up postgres redis   Bring up specific services",
  "$ dx up --no-build       Skip building local services",
  "$ dx up --connect-to staging   Connect deps to staging site",
])

export function upCommand(app: DxBase) {
  return app
    .sub("up")
    .meta({
      description:
        "Bring up the site — all services as containers (prod-like). Run dx dev to overlay native dev servers.",
    })
    .args([
      {
        name: "targets",
        type: "string",
        variadic: true,
        description: "Profile names or service names to bring up",
      },
    ])
    .flags({
      build: {
        type: "boolean",
        description:
          "Build local services (default: true, use --no-build to skip)",
      },
      detach: {
        type: "boolean",
        description: "Run in detached mode (default: true)",
      },
      "connect-to": {
        type: "string" as const,
        description: "Connect all system deps to a site (blanket)",
      },
      connect: {
        type: "string" as const,
        short: "c",
        description: "Per-system connection: system:site (repeatable)",
      },
      prelude: {
        type: "boolean" as const,
        description:
          "Run cached prelude (default: true, use --no-prelude to skip)",
      },
      fresh: {
        type: "boolean" as const,
        description: "Invalidate prelude stamps and re-run every step",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      try {
        const orch = await SiteOrchestrator.create({
          quiet: f.quiet,
          mode: "up",
        })
        const project = orch.project

        // ── Auto-connect (same as dx dev) ────────────────────────
        const userConnect = flags.connect as string | string[] | undefined
        const coveredSystems = coveredSystemsFromConnectFlags(userConnect)
        const auto = autoConnectsFromDeps({
          catalog: project.catalog,
          hasConnectToFlag: Boolean(flags["connect-to"]),
          coveredSystems,
        })
        if (auto.errors.length > 0) {
          for (const err of auto.errors) console.error(`  ! ${err}`)
          exitWithError(
            f,
            `cannot resolve ${auto.errors.length} required system ${auto.errors.length === 1 ? "dependency" : "dependencies"}`
          )
          return
        }
        if (!f.quiet) {
          for (const log of auto.logs) console.log(log)
          for (const warn of auto.warnings) console.warn(`  ! ${warn}`)
        }
        const userConnectList = !userConnect
          ? []
          : Array.isArray(userConnect)
            ? userConnect
            : [userConnect]
        const effectiveConnect = [...userConnectList, ...auto.autoConnects]

        // ── Cached prelude ───────────────────────────────────────
        await runPrelude(orch.ctx, {
          noPrelude: flags.prelude === false,
          fresh: Boolean(flags.fresh),
          connectTo: flags["connect-to"] as string | undefined,
          connectSpecific:
            effectiveConnect.length > 0 ? effectiveConnect : undefined,
          quiet: Boolean(f.quiet),
        })

        // Clean up stale connection override from a previous session
        const overridePath = join(project.rootDir, ".dx", COMPOSE_OVERRIDE_FILE)
        if (existsSync(overridePath)) {
          unlinkSync(overridePath)
        }
        cleanupConnectionContext(project.rootDir)

        // ── Separate targets into profiles and services ──────────
        const knownProfiles = new Set(project.allProfiles)
        const rawTargets = args.targets ?? []
        const profiles: string[] = []
        const services: string[] = []

        if (rawTargets.length === 0) {
          profiles.push(...knownProfiles)
        } else {
          for (const target of rawTargets) {
            if (knownProfiles.has(target)) {
              profiles.push(target)
            } else {
              services.push(target)
            }
          }
        }

        // ── Bring up via orchestrator ────────────────────────────
        await orch.startUpSession({
          targets: services.length > 0 ? services : undefined,
          profiles: profiles.length > 0 ? profiles : undefined,
          noBuild: flags.build === false,
          detach: flags.detach !== false,
          quiet: f.quiet,
        })

        if (!f.json) {
          const parts: string[] = []
          if (profiles.length > 0)
            parts.push(`profiles: ${profiles.join(", ")}`)
          if (services.length > 0)
            parts.push(`services: ${services.join(", ")}`)
          const detail = parts.length > 0 ? ` (${parts.join("; ")})` : ""
          console.log(`Stack started${detail}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
