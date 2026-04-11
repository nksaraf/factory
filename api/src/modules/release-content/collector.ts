import type { Octokit } from "@octokit/rest"
import type {
  ParsedCommit,
  PullRequestSummary,
  OpenApiDiff,
  OpenApiEndpointChange,
  OpenApiSchemaChange,
  ReleaseContext,
} from "@smp/factory-shared/release-content-schema"

// Re-use the conventional commit regex from shared/conventions.ts
const CONVENTIONAL_TYPES =
  "feat|fix|chore|docs|style|refactor|test|build|ci|perf|revert"
const CONVENTIONAL_RE = new RegExp(
  `^(${CONVENTIONAL_TYPES})(\\(([^)]+)\\))?(!)?: (.+)$`
)

/**
 * Parse a conventional commit message into structured data.
 */
export function parseConventionalCommit(
  sha: string,
  message: string,
  author: string,
  date: string
): ParsedCommit | null {
  const firstLine = message.split("\n")[0]?.trim() ?? ""
  const match = CONVENTIONAL_RE.exec(firstLine)
  if (!match) return null

  const body = message.includes("\n")
    ? message.slice(message.indexOf("\n") + 1).trim() || null
    : null

  return {
    sha,
    type: match[1]!,
    scope: match[3] ?? null,
    breaking: match[4] === "!",
    description: match[5]!,
    body,
    author,
    date,
  }
}

/**
 * Collect all inputs needed for release content generation.
 */
export class ReleaseContentCollector {
  constructor(private readonly octokit: Octokit) {}

  /**
   * Collect commits between two tags (or from the beginning if previousVersion is null).
   */
  async collectCommits(
    repoFullName: string,
    previousVersion: string | null,
    currentVersion: string
  ): Promise<ParsedCommit[]> {
    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) return []

    if (!previousVersion) {
      // First release: get all commits up to the current tag
      const commits = await this.octokit.paginate(
        this.octokit.rest.repos.listCommits,
        { owner, repo, sha: currentVersion, per_page: 100 }
      )
      return commits
        .map((c) =>
          parseConventionalCommit(
            c.sha,
            c.commit.message,
            c.author?.login ?? c.commit.author?.name ?? "unknown",
            c.commit.author?.date ?? ""
          )
        )
        .filter((c): c is ParsedCommit => c !== null)
    }

    const { data } = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${previousVersion}...${currentVersion}`,
    })

    return data.commits
      .map((c) =>
        parseConventionalCommit(
          c.sha,
          c.commit.message,
          c.author?.login ?? c.commit.author?.name ?? "unknown",
          c.commit.author?.date ?? ""
        )
      )
      .filter((c): c is ParsedCommit => c !== null)
  }

  /**
   * Collect merged PRs between two dates.
   */
  async collectPullRequests(
    repoFullName: string,
    sinceDate: string | null,
    untilDate: string
  ): Promise<PullRequestSummary[]> {
    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) return []

    // Use a manual pagination approach to stop early when PRs are older
    // than the since date, avoiding fetching the entire PR history.
    const result: PullRequestSummary[] = []
    const sinceTime = sinceDate ? new Date(sinceDate).getTime() : 0
    const untilTime = new Date(untilDate).getTime()
    let page = 1
    let done = false

    while (!done) {
      const { data: pulls } = await this.octokit.rest.pulls.list({
        owner,
        repo,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
      })

      if (pulls.length === 0) break

      for (const pr of pulls) {
        if (!pr.merged_at) continue
        const mergedTime = new Date(pr.merged_at).getTime()

        // Since PRs are sorted by updated desc, once we see PRs older than
        // our window, we can stop paginating.
        if (pr.updated_at && new Date(pr.updated_at).getTime() < sinceTime) {
          done = true
          break
        }

        if (mergedTime <= sinceTime) continue
        if (mergedTime > untilTime) continue

        result.push({
          number: pr.number,
          title: pr.title,
          body: pr.body ?? "",
          author: pr.user?.login ?? "unknown",
          labels:
            pr.labels?.map((l) =>
              typeof l === "string" ? l : (l.name ?? "")
            ) ?? [],
          mergedAt: pr.merged_at,
        })
      }

      page++
    }

    return result
  }

  /**
   * Compute an OpenAPI diff between two versions of the spec.
   * Fetches the openapi.json from the repo at each tag.
   */
  async collectOpenApiDiff(
    repoFullName: string,
    previousVersion: string | null,
    currentVersion: string
  ): Promise<OpenApiDiff | null> {
    if (!previousVersion) return null

    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) return null

    let oldSpec: Record<string, unknown> | null = null
    let newSpec: Record<string, unknown> | null = null

    try {
      const oldContent = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: "openapi.json",
        ref: previousVersion,
      })
      if ("content" in oldContent.data) {
        oldSpec = JSON.parse(
          Buffer.from(oldContent.data.content, "base64").toString()
        )
      }
    } catch {
      // openapi.json may not exist at the old tag
    }

    try {
      const newContent = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: "openapi.json",
        ref: currentVersion,
      })
      if ("content" in newContent.data) {
        newSpec = JSON.parse(
          Buffer.from(newContent.data.content, "base64").toString()
        )
      }
    } catch {
      // openapi.json may not exist at the new tag
    }

    if (!oldSpec && !newSpec) return null

    return diffOpenApiSpecs(oldSpec, newSpec)
  }

  /**
   * Read design spec files from the repo.
   */
  async collectDesignSpecs(
    repoFullName: string,
    ref: string
  ): Promise<string[]> {
    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) return []

    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: ".context/plans",
        ref,
      })

      if (!Array.isArray(data)) return []

      const specs: string[] = []
      for (const file of data) {
        if (file.type !== "file" || !file.name.endsWith(".md")) continue
        try {
          const { data: content } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.path,
            ref,
          })
          if ("content" in content) {
            specs.push(Buffer.from(content.content, "base64").toString())
          }
        } catch {
          // skip unreadable files
        }
      }
      return specs
    } catch {
      return []
    }
  }

  /**
   * Get the date of a tag (for filtering PRs).
   */
  async getTagDate(repoFullName: string, tag: string): Promise<string | null> {
    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) return null

    try {
      const { data: ref } = await this.octokit.rest.git.getRef({
        owner,
        repo,
        ref: `tags/${tag}`,
      })

      if (ref.object.type === "tag") {
        const { data: tagObj } = await this.octokit.rest.git.getTag({
          owner,
          repo,
          tag_sha: ref.object.sha,
        })
        return tagObj.tagger?.date ?? null
      }

      // Lightweight tag — get commit date
      const { data: commit } = await this.octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: ref.object.sha,
      })
      return commit.author.date
    } catch {
      return null
    }
  }

  /**
   * Find the previous release tag.
   */
  async findPreviousTag(
    repoFullName: string,
    currentTag: string
  ): Promise<string | null> {
    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) return null

    try {
      const tags = await this.octokit.paginate(
        this.octokit.rest.repos.listTags,
        { owner, repo, per_page: 100 }
      )

      // Find the current tag, then return the next one (previous chronologically)
      const versionTags = tags
        .filter((t) => /^v?\d+\.\d+/.test(t.name))
        .map((t) => t.name)

      const currentIdx = versionTags.indexOf(currentTag)
      if (currentIdx === -1 || currentIdx === versionTags.length - 1) {
        // Try without the v prefix
        const altTag = currentTag.startsWith("v")
          ? currentTag.slice(1)
          : `v${currentTag}`
        const altIdx = versionTags.indexOf(altTag)
        if (altIdx === -1 || altIdx === versionTags.length - 1) return null
        return versionTags[altIdx + 1] ?? null
      }

      return versionTags[currentIdx + 1] ?? null
    } catch {
      return null
    }
  }

  /**
   * Collect all release context data.
   */
  async collect(
    repoFullName: string,
    version: string
  ): Promise<ReleaseContext> {
    const currentTag = version.startsWith("v") ? version : `v${version}`
    const previousTag = await this.findPreviousTag(repoFullName, currentTag)

    const [commits, currentDate, previousDate, designSpecs, openApiDiff] =
      await Promise.all([
        this.collectCommits(repoFullName, previousTag, currentTag),
        this.getTagDate(repoFullName, currentTag),
        previousTag
          ? this.getTagDate(repoFullName, previousTag)
          : Promise.resolve(null),
        this.collectDesignSpecs(repoFullName, currentTag),
        this.collectOpenApiDiff(repoFullName, previousTag, currentTag),
      ])

    const pullRequests = await this.collectPullRequests(
      repoFullName,
      previousDate,
      currentDate ?? new Date().toISOString()
    )

    return {
      version,
      previousVersion: previousTag ? previousTag.replace(/^v/, "") : null,
      repoFullName,
      releaseDate: currentDate ?? new Date().toISOString().split("T")[0]!,
      commits,
      pullRequests,
      openApiDiff,
      designSpecs,
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function diffOpenApiSpecs(
  oldSpec: Record<string, unknown> | null,
  newSpec: Record<string, unknown> | null
): OpenApiDiff {
  const endpointChanges: OpenApiEndpointChange[] = []
  const schemaChanges: OpenApiSchemaChange[] = []

  const oldPaths = extractPaths(oldSpec)
  const newPaths = extractPaths(newSpec)

  // Find added and modified endpoints
  for (const [key, info] of newPaths) {
    if (!oldPaths.has(key)) {
      endpointChanges.push({
        method: info.method,
        path: info.path,
        changeType: "added",
        summary: info.summary,
      })
    } else {
      const oldInfo = oldPaths.get(key)!
      if (JSON.stringify(oldInfo) !== JSON.stringify(info)) {
        endpointChanges.push({
          method: info.method,
          path: info.path,
          changeType: "modified",
          summary: info.summary,
        })
      }
    }
  }

  // Find removed endpoints
  for (const [key, info] of oldPaths) {
    if (!newPaths.has(key)) {
      endpointChanges.push({
        method: info.method,
        path: info.path,
        changeType: "removed",
        summary: info.summary,
      })
    }
  }

  // Diff schemas
  const oldSchemas = extractSchemas(oldSpec)
  const newSchemas = extractSchemas(newSpec)

  for (const name of newSchemas) {
    if (!oldSchemas.has(name)) {
      schemaChanges.push({ name, changeType: "added" })
    }
  }
  for (const name of oldSchemas) {
    if (!newSchemas.has(name)) {
      schemaChanges.push({ name, changeType: "removed" })
    }
  }

  return { endpointChanges, schemaChanges }
}

interface PathInfo {
  method: string
  path: string
  summary?: string
}

function extractPaths(
  spec: Record<string, unknown> | null
): Map<string, PathInfo> {
  const result = new Map<string, PathInfo>()
  if (!spec) return result

  const paths = spec.paths as
    | Record<string, Record<string, unknown>>
    | undefined
  if (!paths) return result

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, detail] of Object.entries(methods)) {
      if (typeof detail !== "object" || detail === null) continue
      const key = `${method.toUpperCase()} ${path}`
      result.set(key, {
        method: method.toUpperCase(),
        path,
        summary: (detail as Record<string, unknown>).summary as
          | string
          | undefined,
      })
    }
  }
  return result
}

function extractSchemas(spec: Record<string, unknown> | null): Set<string> {
  if (!spec) return new Set()
  const components = spec.components as Record<string, unknown> | undefined
  if (!components) return new Set()
  const schemas = components.schemas as Record<string, unknown> | undefined
  if (!schemas) return new Set()
  return new Set(Object.keys(schemas))
}
