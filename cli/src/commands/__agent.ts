import type { DxBase } from "../dx-root.js"

/**
 * dx __agent — internal command: run site agent daemon.
 * Invoked by spawnAgentDaemon(), not by users directly.
 */
export function __agentCommand(app: DxBase) {
  return app
    .sub("__agent")
    .meta({
      description: "Internal: run site agent daemon",
    })
    .args([
      {
        name: "config-path",
        type: "string" as const,
        required: true,
        description: "Path to agent config JSON",
      },
    ])
    .run(async ({ args }) => {
      // Dynamic import to keep the main CLI fast
      await import("../site/agent-daemon.js")
    })
}
