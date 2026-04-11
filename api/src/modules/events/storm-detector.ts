import { logger } from "../../logger"

interface StormConfig {
  thresholdPerMinute: number
  windowMs: number
}

interface BucketEntry {
  count: number
  firstSeen: number
  lastSeen: number
}

export class StormDetector {
  private config: StormConfig
  private buckets = new Map<string, BucketEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: StormConfig) {
    this.config = config
    this.cleanupTimer = setInterval(() => this.tick(), config.windowMs)
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  record(topicPrefix: string, scopeId: string): boolean {
    const k = `${topicPrefix}:${scopeId}`
    const now = Date.now()

    let bucket = this.buckets.get(k)
    if (!bucket || now - bucket.firstSeen > this.config.windowMs) {
      bucket = { count: 0, firstSeen: now, lastSeen: now }
      this.buckets.set(k, bucket)
    }

    bucket.count++
    bucket.lastSeen = now

    const isStorm = bucket.count > this.config.thresholdPerMinute
    if (isStorm && bucket.count === this.config.thresholdPerMinute + 1) {
      logger.warn(
        { topicPrefix, scopeId, count: bucket.count },
        "storm-detector: storm threshold exceeded"
      )
    }
    return isStorm
  }

  isStorming(topicPrefix: string, scopeId: string): boolean {
    const bucket = this.buckets.get(`${topicPrefix}:${scopeId}`)
    if (!bucket) return false
    if (Date.now() - bucket.firstSeen > this.config.windowMs) return false
    return bucket.count > this.config.thresholdPerMinute
  }

  activeStorms(): Array<{
    topicPrefix: string
    scopeId: string
    count: number
    since: number
  }> {
    const now = Date.now()
    const storms: Array<{
      topicPrefix: string
      scopeId: string
      count: number
      since: number
    }> = []
    for (const [k, bucket] of this.buckets) {
      if (
        now - bucket.firstSeen <= this.config.windowMs &&
        bucket.count > this.config.thresholdPerMinute
      ) {
        const [topicPrefix, scopeId] = k.split(":")
        storms.push({
          topicPrefix,
          scopeId,
          count: bucket.count,
          since: bucket.firstSeen,
        })
      }
    }
    return storms
  }

  tick(): void {
    const now = Date.now()
    for (const [k, bucket] of this.buckets) {
      if (now - bucket.firstSeen > this.config.windowMs) {
        this.buckets.delete(k)
      }
    }
  }
}
