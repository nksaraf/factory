/**
 * NATS-style wildcard topic matching.
 * Topics are dot-separated segments: "ops.workbench.created"
 * Wildcards:
 *   * — matches exactly one segment
 *   > — matches one or more segments (must be last token)
 */

export function matchTopic(filter: string, topic: string): boolean {
  const filterParts = filter.split(".")
  const topicParts = topic.split(".")

  for (let i = 0; i < filterParts.length; i++) {
    const f = filterParts[i]
    if (f === ">") return i < topicParts.length
    if (i >= topicParts.length) return false
    if (f === "*") continue
    if (f !== topicParts[i]) return false
  }

  return filterParts.length === topicParts.length
}

export function matchTopicAny(filters: string[], topic: string): boolean {
  return filters.some((f) => matchTopic(f, topic))
}
