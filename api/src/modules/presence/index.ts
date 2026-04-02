/**
 * Presence WebSocket controller — ephemeral "who's viewing what" awareness.
 *
 * Protocol:
 *   Client -> Server: join, leave, heartbeat
 *   Server -> Client: presence (full user list), user_joined, user_left
 *
 * Multi-instance fan-out via Redis pub/sub (optional — degrades gracefully
 * to single-instance mode when Redis is unavailable).
 */
import { Elysia, t } from "elysia"
import type { Redis } from "ioredis"
import { randomUUID } from "node:crypto"

import { logger } from "../../logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresenceEntry {
  userId: string
  userName?: string
  joinedAt: number
  lastSeen: number
}

interface RoomState {
  users: Map<string, PresenceEntry>
  /** All WebSocket connections subscribed to this room */
  connections: Set<unknown>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_TIMEOUT_MS = 45_000
const EVICTION_INTERVAL_MS = 10_000
const INSTANCE_ID = randomUUID()

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * @param getRedis — lazy getter for Redis connections. Called at runtime so
 * Redis can be initialized after the Elysia app is created (e.g. in setupDb).
 */
export function presenceController(
  getRedis?: () => { publisher: Redis; subscriber: Redis } | undefined
) {
  const rooms = new Map<string, RoomState>()
  const connectionRooms = new Map<
    unknown,
    { userId: string; rooms: Set<string> }
  >()

  let redisSubscribed = false

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getOrCreateRoom(room: string): RoomState {
    let state = rooms.get(room)
    if (!state) {
      state = { users: new Map(), connections: new Set() }
      rooms.set(room, state)
    }
    return state
  }

  function getRoomUserList(room: string): PresenceEntry[] {
    const state = rooms.get(room)
    if (!state) return []
    return Array.from(state.users.values())
  }

  /** Broadcast a message to all local WebSocket connections in a room, optionally excluding one. */
  function broadcastToLocalRoom(
    room: string,
    message: Record<string, unknown>,
    exclude?: unknown
  ) {
    const state = rooms.get(room)
    if (!state) return
    const payload = JSON.stringify(message)
    for (const conn of state.connections) {
      if (conn !== exclude) {
        try {
          ;(conn as any).send(payload)
        } catch {
          // Connection may have closed
        }
      }
    }
  }

  function publishToRedis(room: string, message: Record<string, unknown>) {
    const redis = getRedis?.()
    if (!redis) return

    redis.publisher
      .publish(
        `presence:${room}`,
        JSON.stringify({ ...message, _instanceId: INSTANCE_ID })
      )
      .catch((err: Error) =>
        logger.warn({ err }, "Redis presence publish failed")
      )
  }

  function ensureRedisSubscribed() {
    if (redisSubscribed) return
    const redis = getRedis?.()
    if (!redis) return

    redisSubscribed = true
    redis.subscriber.psubscribe("presence:*").catch((err) => {
      logger.warn({ err }, "Failed to subscribe to presence channels")
      redisSubscribed = false
    })

    redis.subscriber.on("pmessage", (_pattern, channel, message) => {
      try {
        const data = JSON.parse(message)
        if (data._instanceId === INSTANCE_ID) return

        const room = channel.replace("presence:", "")
        const state = getOrCreateRoom(room)

        if (data.type === "user_joined") {
          state.users.set(data.user.userId, data.user)
          broadcastToLocalRoom(room, {
            type: "user_joined",
            room,
            user: data.user,
          })
        } else if (data.type === "user_left") {
          state.users.delete(data.userId)
          broadcastToLocalRoom(room, {
            type: "user_left",
            room,
            userId: data.userId,
          })
        } else if (data.type === "heartbeat") {
          const existing = state.users.get(data.userId)
          if (existing) {
            existing.lastSeen = Date.now()
          }
        }
      } catch (err) {
        logger.warn({ err }, "Failed to process presence message from Redis")
      }
    })
  }

  function cleanupRoom(roomName: string) {
    const state = rooms.get(roomName)
    if (state && state.users.size === 0 && state.connections.size === 0) {
      rooms.delete(roomName)
    }
  }

  // Periodic eviction of stale entries
  const evictionTimer = setInterval(() => {
    const now = Date.now()
    for (const [roomName, state] of rooms) {
      for (const [userId, entry] of state.users) {
        if (now - entry.lastSeen > HEARTBEAT_TIMEOUT_MS) {
          state.users.delete(userId)
          broadcastToLocalRoom(roomName, {
            type: "user_left",
            room: roomName,
            userId,
          })
          logger.debug(
            { room: roomName, userId },
            "Evicted stale presence entry"
          )
        }
      }
      cleanupRoom(roomName)
    }
  }, EVICTION_INTERVAL_MS)

  return new Elysia({ prefix: "/presence" })
    .ws("/ws", {
      body: t.Object({
        type: t.Union([
          t.Literal("join"),
          t.Literal("leave"),
          t.Literal("heartbeat"),
        ]),
        room: t.String(),
        userId: t.String(),
        userName: t.Optional(t.String()),
      }),

      open(ws) {
        ensureRedisSubscribed()
        logger.debug("Presence WebSocket connected")
      },

      message(ws, data) {
        const { type, room, userId, userName } = data

        switch (type) {
          case "join": {
            const state = getOrCreateRoom(room)
            const entry: PresenceEntry = {
              userId,
              userName,
              joinedAt: Date.now(),
              lastSeen: Date.now(),
            }
            state.users.set(userId, entry)
            state.connections.add(ws)

            let connState = connectionRooms.get(ws)
            if (!connState) {
              connState = { userId, rooms: new Set() }
              connectionRooms.set(ws, connState)
            }
            connState.rooms.add(room)

            // Send full user list to the joining client
            ws.send(
              JSON.stringify({
                type: "presence",
                room,
                users: getRoomUserList(room),
              })
            )

            // Notify other local clients in this room
            broadcastToLocalRoom(
              room,
              { type: "user_joined", room, user: entry },
              ws // exclude the joining client
            )

            // Fan out to other instances via Redis
            publishToRedis(room, { type: "user_joined", room, user: entry })
            break
          }

          case "leave": {
            const state = rooms.get(room)
            if (state) {
              state.users.delete(userId)
              state.connections.delete(ws)
            }

            const connState = connectionRooms.get(ws)
            if (connState) {
              connState.rooms.delete(room)
            }

            broadcastToLocalRoom(room, { type: "user_left", room, userId })
            publishToRedis(room, { type: "user_left", room, userId })
            cleanupRoom(room)
            break
          }

          case "heartbeat": {
            const state = rooms.get(room)
            if (state) {
              const existing = state.users.get(userId)
              if (existing) {
                existing.lastSeen = Date.now()
              }
            }

            publishToRedis(room, { type: "heartbeat", room, userId })
            break
          }
        }
      },

      close(ws) {
        const connState = connectionRooms.get(ws)
        if (connState) {
          for (const room of connState.rooms) {
            const state = rooms.get(room)
            if (state) {
              state.users.delete(connState.userId)
              state.connections.delete(ws)
            }
            broadcastToLocalRoom(room, {
              type: "user_left",
              room,
              userId: connState.userId,
            })
            publishToRedis(room, {
              type: "user_left",
              room,
              userId: connState.userId,
            })
            cleanupRoom(room)
          }
          connectionRooms.delete(ws)
        }
        logger.debug("Presence WebSocket disconnected")
      },
    })
    .onStop(() => {
      clearInterval(evictionTimer)
    })
}
