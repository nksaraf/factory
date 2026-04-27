/**
 * Session manager — tracks active agent sessions, manages lifecycle.
 *
 * For MVP: local sessions only (agent process on same machine as API).
 * Remote sessions (via tunnel to dx dev) come in Phase 2.4.
 */
import { eq, and } from "drizzle-orm"
import type { Database } from "../../db/connection"
import { session, thread, message } from "../../db/schema/org"
import { newId } from "../../lib/id"
import { logger } from "../../logger"
import { ingestMessages } from "../messages/message.service"
import type { IRMessage } from "@smp/factory-shared/schemas/message-ir"

const log = logger.child({ module: "session-manager" })

export interface ActiveSession {
  id: string
  threadId: string
  mode: "drive" | "follow" | "native"
  status: string
  agentType: string
  process?: {
    pid: number
    stdin: WritableStream | null
    kill: (signal?: string) => void
  }
  cursorMessageId: string | null
}

const activeSessions = new Map<string, ActiveSession>()

export function getActiveSession(sessionId: string): ActiveSession | undefined {
  return activeSessions.get(sessionId)
}

export function getSessionForThread(
  threadId: string
): ActiveSession | undefined {
  for (const s of activeSessions.values()) {
    if (s.threadId === threadId && s.status !== "completed") return s
  }
  return undefined
}

export function listActiveSessions(): ActiveSession[] {
  return [...activeSessions.values()].filter((s) => s.status !== "completed")
}

export async function createSession(
  db: Database,
  opts: {
    threadId: string
    principalId: string
    mode: "drive" | "follow" | "native"
    agentType: string
    siteId?: string
    workbenchId?: string
    sandboxProvider?: string
  }
): Promise<string> {
  const id = newId("sess")

  await db.insert(session).values({
    id,
    threadId: opts.threadId,
    siteId: opts.siteId ?? null,
    workbenchId: opts.workbenchId ?? null,
    sandboxProvider: opts.sandboxProvider ?? "none",
    agentHostKind: "site",
    principalId: opts.principalId,
    mode: opts.mode,
    status: "created",
    agentType: opts.agentType,
    startedAt: new Date(),
  })

  activeSessions.set(id, {
    id,
    threadId: opts.threadId,
    mode: opts.mode,
    status: "created",
    agentType: opts.agentType,
    cursorMessageId: null,
  })

  log.info(
    { sessionId: id, threadId: opts.threadId, mode: opts.mode },
    "session created"
  )
  return id
}

export async function updateSessionStatus(
  db: Database,
  sessionId: string,
  status: string
): Promise<void> {
  await db
    .update(session)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "completed" ? { endedAt: new Date() } : {}),
    })
    .where(eq(session.id, sessionId))

  const active = activeSessions.get(sessionId)
  if (active) {
    active.status = status
    if (status === "completed") {
      activeSessions.delete(sessionId)
    }
  }
}

export async function endSession(
  db: Database,
  sessionId: string
): Promise<void> {
  const active = activeSessions.get(sessionId)
  if (active?.process) {
    active.process.kill("SIGINT")
  }
  await updateSessionStatus(db, sessionId, "completed")
  log.info({ sessionId }, "session ended")
}
