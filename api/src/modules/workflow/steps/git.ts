/**
 * Git host steps — branch creation, PR comments, etc.
 */

import { createStep } from "../../../lib/workflow-engine";
import { getGitHostAdapter } from "../../../adapters/adapter-registry";
import type { GitHostAdapterConfig, GitHostType } from "../../../adapters/git-host-adapter";

export const createBranch = createStep({
  name: "git.createBranch",
  retries: { maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 },
  fn: async (input: {
    repoFullName: string;
    branchName: string;
    fromRef: string;
    hostType: GitHostType;
    hostConfig: GitHostAdapterConfig;
  }) => {
    const adapter = getGitHostAdapter(input.hostType, input.hostConfig);
    return adapter.createBranch(input.repoFullName, input.branchName, input.fromRef);
  },
});

export const postPRComment = createStep({
  name: "git.postPRComment",
  retries: { maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 },
  fn: async (input: {
    repoFullName: string;
    prNumber: number;
    body: string;
    hostType: GitHostType;
    hostConfig: GitHostAdapterConfig;
  }) => {
    const adapter = getGitHostAdapter(input.hostType, input.hostConfig);
    return adapter.postPRComment(input.repoFullName, input.prNumber, input.body);
  },
});
