import Anthropic from "@anthropic-ai/sdk"
import type {
  ReleaseContext,
  ReleaseContentConfig,
  ReleaseContentOutputType,
  GeneratedContent,
  ParsedCommit,
} from "@smp/factory-shared/release-content-schema"
import { logger } from "../../logger"

// ---------------------------------------------------------------------------
// Default prompts for each output type
// ---------------------------------------------------------------------------

const DEFAULT_PROMPTS: Record<ReleaseContentOutputType, string> = {
  changelog: `You are a technical writer producing a changelog entry in Keep A Changelog format (https://keepachangelog.com).

Given the release context below, produce a changelog entry for this version. Group changes under these headings (omit empty sections):
- ### Added (feat commits)
- ### Fixed (fix commits)
- ### Changed (refactor, perf commits)
- ### Deprecated
- ### Removed
- ### Security
- ### Breaking Changes (any commit with breaking flag)

Each item should be a concise, technical description. Include the scope in parentheses if present.
Include PR numbers as links where available.
Do NOT include a top-level heading — the caller will add the version heading.`,

  "release-notes": `You are a product writer creating user-facing release notes.

Given the release context below, write release notes that non-technical users can understand.
- Lead with the most impactful features and improvements
- Translate technical changes into user benefits
- Use clear, simple language
- Group into: New Features, Improvements, Bug Fixes (omit empty sections)
- Do NOT mention internal refactoring, CI changes, or chore commits
- Keep it concise — aim for 200-400 words`,

  "api-docs": `You are an API documentation writer.

Given the OpenAPI diff and commit context below, document what changed in the API:
- New endpoints: describe purpose, method, path, key parameters
- Removed endpoints: note what was removed and any migration path
- Modified endpoints: describe what changed (parameters, response shape, behavior)
- Schema changes: note new or removed types
- Include migration notes for any breaking changes

Use clear technical language. Format as markdown with code blocks for endpoint paths.`,

  "internal-docs": `You are a technical architect writing internal documentation.

Given the release context and design specifications below, document:
- Key architectural decisions made in this release
- How the system has evolved (new modules, changed data flow, new integrations)
- Important implementation details that future developers should know
- Any technical debt introduced or resolved
- Links between the changes and the design specs where relevant

Write for an audience of senior engineers joining the team.`,

  announcement: `You are a product marketing writer creating a release announcement.

Given the release context below, write a compelling blog post / announcement:
- Start with a strong headline and opening paragraph
- Highlight 2-3 key features or improvements with their user benefits
- Include a brief "what's next" section if the design specs suggest upcoming work
- Keep the tone professional but enthusiastic
- Aim for 300-500 words
- Do NOT include overly technical details — link to the changelog for those`,
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export class ReleaseContentGenerator {
  private readonly client: Anthropic
  private readonly model: string

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic({
      apiKey:
        opts?.apiKey ??
        process.env.LLM_API_KEY ??
        process.env.ANTHROPIC_API_KEY,
    })
    this.model =
      opts?.model ?? process.env.LLM_MODEL ?? "claude-sonnet-4-20250514"
  }

  /**
   * Generate content for all requested output types.
   */
  async generate(
    context: ReleaseContext,
    config: ReleaseContentConfig
  ): Promise<GeneratedContent[]> {
    const settled = await Promise.allSettled(
      config.outputs.map((outputType) =>
        this.generateOne(outputType, context, config)
      )
    )

    const results: GeneratedContent[] = []
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!
      if (result.status === "fulfilled") {
        results.push(result.value)
      } else {
        logger.error(
          { err: result.reason, outputType: config.outputs[i] },
          "Failed to generate release content"
        )
      }
    }

    return results
  }

  private async generateOne(
    outputType: ReleaseContentOutputType,
    context: ReleaseContext,
    config: ReleaseContentConfig
  ): Promise<GeneratedContent> {
    const systemPrompt =
      config.prompts?.[outputType] ?? DEFAULT_PROMPTS[outputType]

    const userMessage = buildUserMessage(outputType, context)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    })

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")

    const filename = getFilename(outputType, context.version, config)

    return {
      type: outputType,
      filename,
      content: formatContent(outputType, text, context),
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserMessage(
  outputType: ReleaseContentOutputType,
  context: ReleaseContext
): string {
  const parts: string[] = []

  parts.push(`## Release: v${context.version}`)
  parts.push(`Date: ${context.releaseDate}`)
  if (context.previousVersion) {
    parts.push(`Previous version: v${context.previousVersion}`)
  }
  parts.push("")

  // Commits grouped by type
  if (context.commits.length > 0) {
    parts.push("## Commits")
    const grouped = groupCommitsByType(context.commits)
    for (const [type, commits] of Object.entries(grouped)) {
      parts.push(`\n### ${type}`)
      for (const c of commits) {
        const scope = c.scope ? `(${c.scope})` : ""
        const breaking = c.breaking ? " [BREAKING]" : ""
        parts.push(
          `- ${c.sha.slice(0, 7)} ${type}${scope}${breaking}: ${c.description} (${c.author})`
        )
      }
    }
    parts.push("")
  }

  // Pull requests
  if (context.pullRequests.length > 0) {
    parts.push("## Pull Requests")
    for (const pr of context.pullRequests) {
      parts.push(`- #${pr.number}: ${pr.title} (@${pr.author})`)
      if (pr.body) {
        // Include first 200 chars of PR body for context
        const truncated =
          pr.body.length > 200 ? pr.body.slice(0, 200) + "..." : pr.body
        parts.push(`  ${truncated}`)
      }
    }
    parts.push("")
  }

  // OpenAPI diff (only for api-docs and changelog)
  if (
    context.openApiDiff &&
    (outputType === "api-docs" || outputType === "changelog")
  ) {
    parts.push("## OpenAPI Changes")
    for (const change of context.openApiDiff.endpointChanges) {
      parts.push(
        `- [${change.changeType.toUpperCase()}] ${change.method} ${change.path}${change.summary ? ` — ${change.summary}` : ""}`
      )
    }
    for (const change of context.openApiDiff.schemaChanges) {
      parts.push(`- [SCHEMA ${change.changeType.toUpperCase()}] ${change.name}`)
    }
    parts.push("")
  }

  // Design specs (only for internal-docs and announcement)
  if (
    context.designSpecs.length > 0 &&
    (outputType === "internal-docs" || outputType === "announcement")
  ) {
    parts.push("## Design Specifications (for context)")
    for (const spec of context.designSpecs) {
      // Truncate long specs to avoid token overflow
      const truncated =
        spec.length > 2000 ? spec.slice(0, 2000) + "\n...(truncated)" : spec
      parts.push(truncated)
      parts.push("---")
    }
    parts.push("")
  }

  return parts.join("\n")
}

function groupCommitsByType(
  commits: ParsedCommit[]
): Record<string, ParsedCommit[]> {
  const grouped: Record<string, ParsedCommit[]> = {}
  for (const commit of commits) {
    const type = commit.type
    if (!grouped[type]) grouped[type] = []
    grouped[type].push(commit)
  }
  return grouped
}

function getFilename(
  outputType: ReleaseContentOutputType,
  version: string,
  config: ReleaseContentConfig
): string {
  switch (outputType) {
    case "changelog":
      return config.changelogPath
    case "release-notes":
      return `${config.docsDir}/v${version}.md`
    case "api-docs":
      return `docs/api/v${version}-changes.md`
    case "internal-docs":
      return `docs/internal/v${version}.md`
    case "announcement":
      return `docs/announcements/v${version}.md`
  }
}

function formatContent(
  outputType: ReleaseContentOutputType,
  generatedText: string,
  context: ReleaseContext
): string {
  if (outputType === "changelog") {
    // Wrap in version heading for changelog
    return `## [${context.version}] - ${context.releaseDate}\n\n${generatedText}\n`
  }

  // Add a header for standalone docs
  const titles: Record<ReleaseContentOutputType, string> = {
    changelog: "",
    "release-notes": `Release Notes — v${context.version}`,
    "api-docs": `API Changes — v${context.version}`,
    "internal-docs": `Internal Documentation — v${context.version}`,
    announcement: "",
  }

  const title = titles[outputType]
  if (title) {
    return `# ${title}\n\n_Released: ${context.releaseDate}_\n\n${generatedText}\n`
  }

  return generatedText
}
