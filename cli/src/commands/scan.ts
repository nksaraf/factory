import type { DxBase } from "../dx-root.js"
import { runScan } from "../handlers/scan.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("scan", [
  "$ dx scan                              Scan IDE sources + local infra",
  "$ dx scan --scanner ide                IDE sources only",
  "$ dx scan --scanner infra              Infra scan on localhost",
  "$ dx scan web01                        Infra scan on remote host 'web01'",
  "$ dx scan claude-code                  Sync only Claude Code sessions",
  "$ dx scan cloudflare                   Sync DNS from all Cloudflare accounts",
  "$ dx scan dns                          Sync DNS from all configured providers",
  "$ dx scan --scanner dns my-estate      Sync DNS for a specific estate",
  "$ dx scan --dry-run                    Preview without sending",
  "$ dx scan --json                       Machine-readable output",
  "$ dx scan web01 --deep                 Spider-crawl: scan host + all discovered backends",
])

export function scanCommand(app: DxBase) {
  return app
    .sub("scan")
    .meta({
      description:
        "Scan IDE sessions and infrastructure hosts, syncing to Factory",
    })
    .args([
      {
        name: "target",
        type: "string",
        description:
          "Target: an IDE source (claude-code, conductor, cursor) or a host slug for infra scanning",
      },
    ])
    .flags({
      since: {
        type: "string",
        description:
          "Only sync sessions after this date (ISO format, e.g. 2026-04-01)",
      },
      "dry-run": {
        type: "boolean",
        description:
          "Print events/scan results to stdout instead of sending to Factory",
      },
      limit: {
        type: "string",
        description: "Maximum number of events to send (IDE scanner)",
      },
      scanner: {
        type: "string",
        description:
          "Scanner to run: ide, infra, dns (or cloudflare), all. DNS is opt-in (default: all = ide + infra)",
      },
      deep: {
        type: "boolean",
        description:
          "Spider-crawl: auto-register discovered backend hosts and submit their scan data",
      },
      file: {
        type: "string",
        description: "YAML inventory file or directory to ingest",
      },
      export: {
        type: "boolean",
        description: "Export current DB entities as YAML inventory files",
      },
      output: {
        type: "string",
        description:
          "Output directory for --export (default: .factory/inventory/)",
      },
      kinds: {
        type: "string",
        description: "Comma-separated entity kinds to export (default: all)",
      },
    })
    .run(async ({ args, flags }) => {
      await runScan(
        toDxFlags(flags),
        (args as Record<string, unknown>).target as string | undefined
      )
    })
}
