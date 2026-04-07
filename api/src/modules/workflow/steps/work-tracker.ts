/**
 * Work tracker steps — fetch issues, update status.
 */

import { createStep } from "../../../lib/workflow-engine";
import { getWorkTrackerAdapter } from "../../../adapters/adapter-registry";
import type { WorkTrackerType } from "../../../adapters/work-tracker-adapter";

export const fetchIssue = createStep({
  name: "workTracker.fetchIssue",
  retries: { maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 },
  fn: async (input: {
    issueId: string;
    apiUrl: string;
    credentialsRef: string;
    trackerType: WorkTrackerType;
  }) => {
    const adapter = getWorkTrackerAdapter(input.trackerType);
    return adapter.getIssue(input.apiUrl, input.credentialsRef, input.issueId);
  },
});

export const updateIssueStatus = createStep({
  name: "workTracker.updateIssueStatus",
  retries: { maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 },
  fn: async (input: {
    issueId: string;
    transitionName: string;
    apiUrl: string;
    credentialsRef: string;
    trackerType: WorkTrackerType;
  }) => {
    const adapter = getWorkTrackerAdapter(input.trackerType);
    await adapter.updateIssueStatus(
      input.apiUrl,
      input.credentialsRef,
      input.issueId,
      input.transitionName,
    );
  },
});
