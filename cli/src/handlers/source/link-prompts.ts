/**
 * Interactive prompts for `dx source link` when run without arguments.
 *
 * Flow:
 *   1. Pick a catalog service (if any have dx.source.* labels) or enter custom repo
 *   2. If custom repo: ask for monorepo subpath
 *   3. Ask for target directory
 *   4. Ask if required or optional
 */

import { select, input } from "@crustjs/prompts"
import { shortSource } from "../pkg/detect.js"
import { listCatalogSources } from "./docker-override.js"
import type { SourceLinkOptions } from "./link.js"

const CUSTOM_REPO_VALUE = "__custom__"

export async function promptSourceLink(
  root: string
): Promise<SourceLinkOptions> {
  // 1. Source selection — catalog services or custom repo
  const catalogSources = listCatalogSources(root)
  let source: string
  let path: string | undefined

  if (catalogSources.length > 0) {
    const choices = [
      ...catalogSources.map((s) => ({
        value: s.serviceName,
        label: s.serviceName,
        hint: `${shortSource(s.sourceRepo)}${s.sourcePath ? `:${s.sourcePath}` : ""}`,
      })),
      {
        value: CUSTOM_REPO_VALUE,
        label: "Custom repository",
        hint: "Enter a Git URL or GitHub shorthand",
      },
    ]

    const picked = await select<string>({
      message: "Which source would you like to link?",
      choices,
    })

    if (picked === CUSTOM_REPO_VALUE) {
      source = await promptCustomRepo()
      path = await promptPath()
    } else {
      source = picked
    }
  } else {
    source = await promptCustomRepo()
    path = await promptPath()
  }

  // 2. Target directory
  const target = await input({
    message: "Target directory (relative to project root)",
    validate: (v) => (v.trim() ? true : "Target directory is required"),
  })

  // 3. Required or optional
  const mode = await select<"required" | "optional">({
    message: "Link mode",
    choices: [
      {
        value: "optional",
        label: "Optional",
        hint: "Local dev only, not shared with team",
      },
      {
        value: "required",
        label: "Required",
        hint: "Committed to package.json, restored by dx sync",
      },
    ],
    default: "optional",
  })

  return {
    source,
    path: path || undefined,
    target,
    require: mode === "required",
  }
}

async function promptCustomRepo(): Promise<string> {
  return input({
    message: "Git repository (GitHub shorthand or URL)",
    validate: (v) => (v.trim() ? true : "Repository is required"),
  })
}

async function promptPath(): Promise<string> {
  return input({
    message: "Subdirectory within the repo (leave empty for root)",
  })
}
