/**
 * Per-source entity resolvers for webhook events.
 *
 * Each resolver is best-effort: if an entity can't be resolved
 * (no identity link, repo not synced, no preview), the ref is
 * simply omitted. Resolvers never throw.
 */
import type { EventRef } from "@smp/factory-shared/schemas/events"
import { and, eq, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import {
  gitRepoSync,
  pipelineRun,
  repo,
  workItem,
  workTrackerProject,
} from "../db/schema/build"
import { site } from "../db/schema/ops"
import { channel, threadChannel } from "../db/schema/org"
import { logger } from "../logger"

const rlog = logger.child({ module: "event-entity-resolver" })

export async function resolveGitHubEntities(
  db: Database,
  providerId: string,
  payload: Record<string, unknown>
): Promise<EventRef[]> {
  const refs: EventRef[] = []

  // Resolve repo via git_repo_sync
  const ghRepo = payload.repository as Record<string, unknown> | undefined
  const externalRepoId = ghRepo?.id != null ? String(ghRepo.id) : undefined

  if (externalRepoId) {
    try {
      const [sync] = await db
        .select({ repoId: gitRepoSync.repoId })
        .from(gitRepoSync)
        .where(
          and(
            eq(gitRepoSync.gitHostProviderId, providerId),
            eq(gitRepoSync.externalRepoId, externalRepoId)
          )
        )
        .limit(1)

      if (sync) {
        refs.push({ kind: "repo", id: sync.repoId, role: "subject" })

        // Resolve system via repo.systemId
        try {
          const [r] = await db
            .select({ systemId: repo.systemId })
            .from(repo)
            .where(eq(repo.id, sync.repoId))
            .limit(1)

          if (r?.systemId) {
            refs.push({ kind: "system", id: r.systemId, role: "context" })
          }
        } catch (err) {
          rlog.warn(
            { repoId: sync.repoId, err },
            "failed to resolve system from repo"
          )
        }
      } else {
        rlog.warn(
          { providerId, externalRepoId },
          "github repo not found in git_repo_sync"
        )
      }
    } catch (err) {
      rlog.warn(
        { providerId, externalRepoId, err },
        "failed to resolve github repo"
      )
    }
  }

  // Resolve preview-type site via trigger metadata (for PR events)
  const pr = payload.pull_request as Record<string, unknown> | undefined
  if (pr) {
    const prNumber = pr.number as number | undefined

    if (prNumber != null) {
      try {
        const [s] = await db
          .select({ id: site.id })
          .from(site)
          .where(
            and(
              eq(site.type, "preview"),
              sql`(${site.spec}->'trigger'->>'prNumber')::int = ${prNumber}`
            )
          )
          .limit(1)

        if (s) {
          refs.push({ kind: "site", id: s.id, role: "target" })
        }
      } catch (err) {
        rlog.warn({ prNumber, err }, "failed to resolve preview site")
      }
    }
  }

  // Resolve pipeline_run via commitSha (for push/PR events)
  const commitSha =
    (payload.after as string) ??
    ((pr?.head as Record<string, unknown>)?.sha as string) ??
    undefined

  if (commitSha) {
    try {
      const [run] = await db
        .select({ id: pipelineRun.id })
        .from(pipelineRun)
        .where(eq(pipelineRun.commitSha, commitSha))
        .limit(1)

      if (run) {
        refs.push({ kind: "pipeline_run", id: run.id, role: "target" })
      }
    } catch (err) {
      rlog.warn({ commitSha, err }, "failed to resolve pipeline_run")
    }
  }

  return refs
}

export async function resolveSlackEntities(
  db: Database,
  _providerId: string,
  payload: Record<string, unknown>
): Promise<EventRef[]> {
  const refs: EventRef[] = []

  const slackEvent = payload.event as Record<string, unknown> | undefined
  const slackChannelId = (slackEvent?.channel ?? payload.channel) as
    | string
    | undefined

  // Resolve channel via kind=slack + externalId
  let resolvedChannelId: string | undefined
  if (slackChannelId) {
    try {
      const [ch] = await db
        .select({ id: channel.id })
        .from(channel)
        .where(
          and(eq(channel.kind, "slack"), eq(channel.externalId, slackChannelId))
        )
        .limit(1)

      if (ch) {
        resolvedChannelId = ch.id
        refs.push({ kind: "channel", id: ch.id, role: "subject" })
      } else {
        rlog.warn(
          { slackChannelId },
          "slack channel not found in channel table"
        )
      }
    } catch (err) {
      rlog.warn({ slackChannelId, err }, "failed to resolve slack channel")
    }
  }

  // Resolve thread via thread_channel spec.slackThreadTs
  const threadTs = (slackEvent?.thread_ts ?? slackEvent?.ts) as
    | string
    | undefined

  if (threadTs && resolvedChannelId) {
    try {
      const threadChannels = await db
        .select({
          threadId: threadChannel.threadId,
          spec: threadChannel.spec,
        })
        .from(threadChannel)
        .where(eq(threadChannel.channelId, resolvedChannelId))
        .limit(100)

      // Check spec JSONB for slackThreadTs match
      const match = threadChannels.find((tc) => {
        const tcSpec = tc.spec as Record<string, unknown> | undefined
        return tcSpec?.slackThreadTs === threadTs
      })

      if (match) {
        refs.push({ kind: "thread", id: match.threadId, role: "subject" })
      }
    } catch (err) {
      rlog.warn({ threadTs, err }, "failed to resolve slack thread")
    }
  }

  return refs
}

export async function resolveJiraEntities(
  db: Database,
  providerId: string,
  payload: Record<string, unknown>
): Promise<EventRef[]> {
  const refs: EventRef[] = []

  // Resolve work_item via workTrackerProviderId + externalId (issue key)
  const issue = payload.issue as Record<string, unknown> | undefined
  const issueKey = issue?.key as string | undefined
  const issueId = issue?.id != null ? String(issue.id) : undefined

  const externalId = issueKey ?? issueId
  if (externalId) {
    try {
      const [wi] = await db
        .select({ id: workItem.id, systemId: workItem.systemId })
        .from(workItem)
        .where(
          and(
            eq(workItem.workTrackerProviderId, providerId),
            eq(workItem.externalId, externalId)
          )
        )
        .limit(1)

      if (wi) {
        refs.push({ kind: "work_item", id: wi.id, role: "subject" })

        // Resolve system via work_item.systemId
        if (wi.systemId) {
          refs.push({ kind: "system", id: wi.systemId, role: "context" })
        }
      } else {
        rlog.warn(
          { providerId, externalId },
          "jira issue not found in work_item"
        )
      }
    } catch (err) {
      rlog.warn(
        { providerId, externalId, err },
        "failed to resolve jira work_item"
      )
    }
  }

  // Resolve work_tracker_project via project ID
  const project = (issue?.fields as Record<string, unknown>)?.project as
    | Record<string, unknown>
    | undefined
  const projectExternalId = project?.id != null ? String(project.id) : undefined

  if (projectExternalId) {
    try {
      const [wtp] = await db
        .select({ id: workTrackerProject.id })
        .from(workTrackerProject)
        .where(
          and(
            eq(workTrackerProject.workTrackerProviderId, providerId),
            eq(workTrackerProject.externalId, projectExternalId)
          )
        )
        .limit(1)

      if (wtp) {
        refs.push({
          kind: "work_tracker_project",
          id: wtp.id,
          role: "context",
        })
      }
    } catch (err) {
      rlog.warn(
        { providerId, projectExternalId, err },
        "failed to resolve jira work_tracker_project"
      )
    }
  }

  return refs
}
