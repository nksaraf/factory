/**
 * NATS JetStream connection and stream management.
 *
 * Provides a singleton connection to NATS, ensures the FACTORY stream
 * exists, and exposes publish/subscribe helpers.
 */
import {
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  RetentionPolicy,
  StorageType,
  StringCodec,
  connect,
} from "nats"

import { logger } from "../logger"

const STREAM_NAME = "FACTORY"
const STREAM_SUBJECTS = ">"

let nc: NatsConnection | null = null
let js: JetStreamClient | null = null

const sc = StringCodec()

/**
 * Get or create a NATS connection + ensure the FACTORY JetStream stream exists.
 * Returns null if NATS_URL is not configured (graceful degradation).
 */
export async function getNatsConnection(): Promise<{
  nc: NatsConnection
  js: JetStreamClient
} | null> {
  const url = process.env.NATS_URL
  if (!url) {
    logger.debug("NATS_URL not set — event broker disabled, outbox will queue")
    return null
  }

  if (nc && !nc.isClosed()) {
    return { nc, js: js! }
  }

  try {
    nc = await connect({ servers: url, name: "factory-api" })
    logger.info({ url }, "nats: connected")

    const jsm = await nc.jetstreamManager()
    await ensureStream(jsm)

    js = nc.jetstream()
    return { nc, js }
  } catch (err) {
    logger.error({ err, url }, "nats: connection failed")
    nc = null
    js = null
    return null
  }
}

async function ensureStream(jsm: JetStreamManager): Promise<void> {
  try {
    await jsm.streams.info(STREAM_NAME)
    logger.debug("nats: FACTORY stream exists")
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: [STREAM_SUBJECTS],
      retention: RetentionPolicy.Limits,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
      storage: StorageType.File,
      num_replicas: 1,
    })
    logger.info("nats: created FACTORY stream")
  }
}

/**
 * Publish an event to NATS JetStream.
 * Returns true on success, false on failure.
 */
export async function publishToNats(
  topic: string,
  payload: string
): Promise<boolean> {
  const conn = await getNatsConnection()
  if (!conn) return false

  try {
    await conn.js.publish(topic, sc.encode(payload))
    return true
  } catch (err) {
    logger.error({ err, topic }, "nats: publish failed")
    return false
  }
}

/**
 * Gracefully close the NATS connection.
 */
export async function closeNats(): Promise<void> {
  if (nc && !nc.isClosed()) {
    await nc.drain()
    nc = null
    js = null
    logger.info("nats: connection closed")
  }
}
