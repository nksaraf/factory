/**
 * Work tracker steps — fetch issues, update status.
 */

import { getWorkTrackerAdapter } from "../../../adapters/adapter-registry"
import type { WorkTrackerType } from "../../../adapters/work-tracker-adapter"

export async function fetchIssue(input: {
  issueId: string
  apiUrl: string
  credentialsRef: string
  trackerType: WorkTrackerType
}) {
  "use step"
  const adapter = getWorkTrackerAdapter(input.trackerType)
  return adapter.getIssue(input.apiUrl, input.credentialsRef, input.issueId)
}

export async function updateIssueStatus(input: {
  issueId: string
  transitionName: string
  apiUrl: string
  credentialsRef: string
  trackerType: WorkTrackerType
}) {
  "use step"
  const adapter = getWorkTrackerAdapter(input.trackerType)
  await adapter.updateIssueStatus(
    input.apiUrl,
    input.credentialsRef,
    input.issueId,
    input.transitionName
  )
}
