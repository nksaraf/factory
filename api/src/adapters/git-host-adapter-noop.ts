import type {
  GitHostAdapter,
  GitHostCheckRun,
  GitHostCollaborator,
  GitHostCommitStatus,
  GitHostRepoInfo,
  WebhookVerification,
} from "./git-host-adapter";

export class NoopGitHostAdapter implements GitHostAdapter {
  readonly hostType = "noop";

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
}
