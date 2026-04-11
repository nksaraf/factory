import { z } from "zod"

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export const releaseContentOutputType = z.enum([
  "changelog",
  "release-notes",
  "api-docs",
  "internal-docs",
  "announcement",
])

export type ReleaseContentOutputType = z.infer<typeof releaseContentOutputType>

// ---------------------------------------------------------------------------
// Configuration (what the caller can customize)
// ---------------------------------------------------------------------------

export const releaseContentConfigSchema = z.object({
  /** Which outputs to generate. Defaults to all. */
  outputs: z
    .array(releaseContentOutputType)
    .default([
      "changelog",
      "release-notes",
      "api-docs",
      "internal-docs",
      "announcement",
    ]),
  /** Custom prompt overrides per output type. */
  prompts: z.record(releaseContentOutputType, z.string()).optional(),
  /** Path for the changelog file. Default: "CHANGELOG.md" */
  changelogPath: z.string().default("CHANGELOG.md"),
  /** Directory for per-release docs. Default: "docs/releases" */
  docsDir: z.string().default("docs/releases"),
  /** Repo full name (owner/repo). Required when calling the API. */
  repoFullName: z.string().optional(),
})

export type ReleaseContentConfig = z.infer<typeof releaseContentConfigSchema>

// ---------------------------------------------------------------------------
// Parsed commit (from conventional commit message)
// ---------------------------------------------------------------------------

export interface ParsedCommit {
  sha: string
  type: string
  scope: string | null
  breaking: boolean
  description: string
  body: string | null
  author: string
  date: string
}

// ---------------------------------------------------------------------------
// Pull request summary
// ---------------------------------------------------------------------------

export interface PullRequestSummary {
  number: number
  title: string
  body: string
  author: string
  labels: string[]
  mergedAt: string
}

// ---------------------------------------------------------------------------
// OpenAPI diff
// ---------------------------------------------------------------------------

export interface OpenApiEndpointChange {
  method: string
  path: string
  changeType: "added" | "removed" | "modified"
  summary?: string
  details?: string
}

export interface OpenApiSchemaChange {
  name: string
  changeType: "added" | "removed" | "modified"
  details?: string
}

export interface OpenApiDiff {
  endpointChanges: OpenApiEndpointChange[]
  schemaChanges: OpenApiSchemaChange[]
}

// ---------------------------------------------------------------------------
// Release context (all inputs bundled for the generator)
// ---------------------------------------------------------------------------

export interface ReleaseContext {
  version: string
  previousVersion: string | null
  repoFullName: string
  releaseDate: string
  commits: ParsedCommit[]
  pullRequests: PullRequestSummary[]
  openApiDiff: OpenApiDiff | null
  designSpecs: string[]
}

// ---------------------------------------------------------------------------
// Generated content (single output file)
// ---------------------------------------------------------------------------

export interface GeneratedContent {
  type: ReleaseContentOutputType
  filename: string
  content: string
}

// ---------------------------------------------------------------------------
// API response
// ---------------------------------------------------------------------------

export interface ReleaseContentResult {
  prUrl: string
  prNumber: number
  generatedFiles: string[]
  version: string
}
