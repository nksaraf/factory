import type {
  GitHostAdapter,
  GitHostCheckRun,
  GitHostCollaborator,
  GitHostComment,
  GitHostCommitStatus,
  GitHostDeployment,
  GitHostDeploymentStatus,
  GitHostPullRequest,
  GitHostPullRequestCreate,
  GitHostRepoInfo,
  WebhookVerification,
} from "./git-host-adapter";

export class NoopGitHostAdapter implements GitHostAdapter {
  readonly type = "noop";

  async getAccessToken(): Promise<string> {
    return "noop-token";
  }

  async listRepos(): Promise<GitHostRepoInfo[]> {
    return [];
  }

  async getRepo(_externalId: string): Promise<GitHostRepoInfo | null> {
    return null;
  }

  async listOrgMembers(): Promise<GitHostCollaborator[]> {
    return [];
  }

  async listCollaborators(
    _repoFullName: string,
  ): Promise<GitHostCollaborator[]> {
    return [];
  }

  async verifyWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookVerification> {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      valid: true,
      eventType: headers["x-github-event"] ?? "unknown",
      deliveryId: headers["x-github-delivery"] ?? "unknown",
      action: parsed.action as string | undefined,
      payload: parsed,
    };
  }

  async createWebhook(
    _repoFullName: string,
    _callbackUrl: string,
    _events: string[],
  ): Promise<{ webhookId: string }> {
    return { webhookId: "noop-webhook" };
  }

  async deleteWebhook(
    _repoFullName: string,
    _webhookId: string,
  ): Promise<void> {}

  async postCommitStatus(
    _repoFullName: string,
    _sha: string,
    _status: GitHostCommitStatus,
  ): Promise<void> {}

  async createCheckRun(
    _repoFullName: string,
    _check: GitHostCheckRun,
  ): Promise<{ checkRunId: string }> {
    return { checkRunId: "noop-check" };
  }

  async updateCheckRun(
    _repoFullName: string,
    _checkRunId: string,
    _update: Partial<GitHostCheckRun>,
  ): Promise<void> {}

  async listPullRequests(
    _repoFullName: string,
    _filters?: { state?: "open" | "closed" | "all" },
  ): Promise<GitHostPullRequest[]> {
    return [];
  }

  async getPullRequest(
    _repoFullName: string,
    _prNumber: number,
  ): Promise<GitHostPullRequest | null> {
    return null;
  }

  async createPullRequest(
    _repoFullName: string,
    _pr: GitHostPullRequestCreate,
  ): Promise<GitHostPullRequest> {
    return {
      number: 0,
      title: "",
      body: "",
      state: "open",
      head: "",
      base: "",
      url: "",
      draft: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: { login: "noop" },
    };
  }

  async mergePullRequest(
    _repoFullName: string,
    _prNumber: number,
    _method?: "merge" | "squash" | "rebase",
  ): Promise<void> {}

  async getPullRequestChecks(
    _repoFullName: string,
    _prNumber: number,
  ): Promise<Array<{ name: string; status: string; conclusion: string | null; url?: string }>> {
    return [];
  }

  async postPRComment(
    _repoFullName: string,
    _prNumber: number,
    _body: string,
  ): Promise<{ commentId: string }> {
    return { commentId: "noop-comment" };
  }

  async listPRComments(
    _repoFullName: string,
    _prNumber: number,
  ): Promise<GitHostComment[]> {
    return [];
  }

  async updatePRComment(
    _repoFullName: string,
    _commentId: number,
    _body: string,
  ): Promise<void> {}

  async createDeployment(
    _repoFullName: string,
    _deployment: GitHostDeployment,
  ): Promise<{ deploymentId: number }> {
    return { deploymentId: 0 };
  }

  async createDeploymentStatus(
    _repoFullName: string,
    _deploymentId: number,
    _status: GitHostDeploymentStatus,
  ): Promise<void> {}

  async createBranch(
    _repoFullName: string,
    branchName: string,
    _fromRef: string,
  ): Promise<{ ref: string; sha: string }> {
    return { ref: `refs/heads/${branchName}`, sha: "0000000000000000000000000000000000000000" };
  }
}
