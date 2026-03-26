import { Octokit } from "@octokit/rest";
import { verify } from "@octokit/webhooks-methods";
import type {
  GitHostAdapter,
  GitHostRepoInfo,
  GitHostCollaborator,
  GitHostCommitStatus,
  GitHostCheckRun,
  GitHostPullRequest,
  GitHostPullRequestCreate,
  WebhookVerification,
} from "./git-host-adapter";

export class GitHubAdapter implements GitHostAdapter {
  readonly hostType = "github";
  private readonly octokit: Octokit;
  private readonly token: string;
  private readonly webhookSecret?: string;
  private readonly org?: string;

  constructor(config: {
    token?: string;
    apiBaseUrl?: string;
    webhookSecret?: string;
    org?: string;
  }) {
    this.token = config.token ?? "";
    this.webhookSecret = config.webhookSecret;
    this.org = config.org;
    this.octokit = new Octokit({
      auth: this.token,
      ...(config.apiBaseUrl && config.apiBaseUrl !== "https://api.github.com"
        ? { baseUrl: config.apiBaseUrl }
        : {}),
    });
  }

  async getAccessToken(): Promise<string> {
    return this.token;
  }

  async listRepos(): Promise<GitHostRepoInfo[]> {
    const repos = this.org
      ? await this.octokit.paginate(
          this.octokit.rest.repos.listForOrg,
          { org: this.org, per_page: 100 },
        )
      : await this.octokit.paginate(
          this.octokit.rest.repos.listForAuthenticatedUser,
          { per_page: 100 },
        );
    return repos.map((r) => ({
      externalId: String(r.id),
      fullName: r.full_name,
      name: r.name,
      defaultBranch: r.default_branch ?? "main",
      gitUrl: r.clone_url ?? r.git_url ?? "",
      isPrivate: r.private,
      description: r.description ?? undefined,
      language: r.language ?? undefined,
      topics: r.topics ?? [],
    }));
  }

  async getRepo(externalId: string): Promise<GitHostRepoInfo | null> {
    try {
      const [owner, repoName] = externalId.includes("/")
        ? externalId.split("/")
        : ["", externalId];
      if (!owner || !repoName) return null;
      const { data: r } = await this.octokit.rest.repos.get({
        owner,
        repo: repoName,
      });
      return {
        externalId: String(r.id),
        fullName: r.full_name,
        name: r.name,
        defaultBranch: r.default_branch ?? "main",
        gitUrl: r.clone_url ?? r.git_url ?? "",
        isPrivate: r.private,
        description: r.description ?? undefined,
        language: r.language ?? undefined,
        topics: r.topics ?? [],
      };
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async listOrgMembers(): Promise<GitHostCollaborator[]> {
    try {
      let org = this.org;
      if (!org) {
        const { data: orgs } = await this.octokit.rest.orgs.listForAuthenticatedUser();
        if (orgs.length === 0) return [];
        org = orgs[0].login;
      }
      const members = await this.octokit.paginate(
        this.octokit.rest.orgs.listMembers,
        { org, per_page: 100 },
      );

      return members.map((m) => ({
        externalUserId: String(m.id),
        login: m.login,
        email: null,
        name: null,
        avatarUrl: m.avatar_url ?? null,
        role: "member",
      }));
    } catch {
      return [];
    }
  }

  async listCollaborators(
    repoFullName: string,
  ): Promise<GitHostCollaborator[]> {
    try {
      const [owner, repoName] = repoFullName.split("/");
      const collabs = await this.octokit.paginate(
        this.octokit.rest.repos.listCollaborators,
        { owner, repo: repoName, per_page: 100 },
      );
      return collabs.map((c) => ({
        externalUserId: String(c.id),
        login: c.login,
        email: null,
        name: null,
        avatarUrl: c.avatar_url ?? null,
        role: c.role_name ?? "read",
      }));
    } catch {
      return [];
    }
  }

  async verifyWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookVerification> {
    const eventType = headers["x-github-event"] ?? "unknown";
    const deliveryId = headers["x-github-delivery"] ?? "";
    const signature = headers["x-hub-signature-256"] ?? "";

    let valid = true;
    if (this.webhookSecret && signature) {
      try {
        valid = await verify(this.webhookSecret, body, signature);
      } catch {
        valid = false;
      }
    }

    let payload: Record<string, unknown> = {};
    let action: string | undefined;
    try {
      payload = JSON.parse(body);
      action = typeof payload.action === "string" ? payload.action : undefined;
    } catch {
      // invalid JSON
    }

    return { valid, eventType, deliveryId, action, payload };
  }

  async createWebhook(
    repoFullName: string,
    callbackUrl: string,
    events: string[],
  ): Promise<{ webhookId: string }> {
    const [owner, repoName] = repoFullName.split("/");
    const { data } = await this.octokit.rest.repos.createWebhook({
      owner,
      repo: repoName,
      config: {
        url: callbackUrl,
        content_type: "json",
        secret: this.webhookSecret,
      },
      events,
      active: true,
    });
    return { webhookId: String(data.id) };
  }

  async deleteWebhook(
    repoFullName: string,
    webhookId: string,
  ): Promise<void> {
    const [owner, repoName] = repoFullName.split("/");
    await this.octokit.rest.repos.deleteWebhook({
      owner,
      repo: repoName,
      hook_id: Number(webhookId),
    });
  }

  async postCommitStatus(
    repoFullName: string,
    sha: string,
    status: GitHostCommitStatus,
  ): Promise<void> {
    const [owner, repoName] = repoFullName.split("/");
    await this.octokit.rest.repos.createCommitStatus({
      owner,
      repo: repoName,
      sha,
      state: status.state,
      target_url: status.targetUrl,
      description: status.description,
      context: status.context,
    });
  }

  async createCheckRun(
    repoFullName: string,
    check: GitHostCheckRun,
  ): Promise<{ checkRunId: string }> {
    const [owner, repoName] = repoFullName.split("/");
    const { data } = await this.octokit.rest.checks.create({
      owner,
      repo: repoName,
      name: check.name,
      head_sha: check.headSha,
      status: check.status,
      conclusion: check.conclusion,
      details_url: check.detailsUrl,
      output: check.output,
    });
    return { checkRunId: String(data.id) };
  }

  async updateCheckRun(
    repoFullName: string,
    checkRunId: string,
    update: Partial<GitHostCheckRun>,
  ): Promise<void> {
    const [owner, repoName] = repoFullName.split("/");
    await this.octokit.rest.checks.update({
      owner,
      repo: repoName,
      check_run_id: Number(checkRunId),
      ...(update.status ? { status: update.status } : {}),
      ...(update.conclusion ? { conclusion: update.conclusion } : {}),
      ...(update.detailsUrl ? { details_url: update.detailsUrl } : {}),
      ...(update.output ? { output: update.output } : {}),
    });
  }

  async listPullRequests(
    repoFullName: string,
    filters?: { state?: "open" | "closed" | "all" },
  ): Promise<GitHostPullRequest[]> {
    const [owner, repoName] = repoFullName.split("/");
    const pulls = await this.octokit.paginate(
      this.octokit.rest.pulls.list,
      { owner, repo: repoName, state: filters?.state ?? "open", per_page: 100 },
    );
    return pulls.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
      head: pr.head.ref,
      base: pr.base.ref,
      url: pr.html_url,
      draft: pr.draft ?? false,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      author: { login: pr.user?.login ?? "unknown" },
    }));
  }

  async getPullRequest(
    repoFullName: string,
    prNumber: number,
  ): Promise<GitHostPullRequest | null> {
    try {
      const [owner, repoName] = repoFullName.split("/");
      const { data: pr } = await this.octokit.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        state: pr.merged ? "merged" : (pr.state as "open" | "closed"),
        head: pr.head.ref,
        base: pr.base.ref,
        url: pr.html_url,
        draft: pr.draft ?? false,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        author: { login: pr.user?.login ?? "unknown" },
      };
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async createPullRequest(
    repoFullName: string,
    pr: GitHostPullRequestCreate,
  ): Promise<GitHostPullRequest> {
    const [owner, repoName] = repoFullName.split("/");
    const { data } = await this.octokit.rest.pulls.create({
      owner,
      repo: repoName,
      title: pr.title,
      body: pr.body,
      head: pr.head,
      base: pr.base,
      draft: pr.draft,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      state: "open",
      head: data.head.ref,
      base: data.base.ref,
      url: data.html_url,
      draft: data.draft ?? false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      author: { login: data.user?.login ?? "unknown" },
    };
  }

  async mergePullRequest(
    repoFullName: string,
    prNumber: number,
    method?: "merge" | "squash" | "rebase",
  ): Promise<void> {
    const [owner, repoName] = repoFullName.split("/");
    await this.octokit.rest.pulls.merge({
      owner,
      repo: repoName,
      pull_number: prNumber,
      merge_method: method,
    });
  }

  async getPullRequestChecks(
    repoFullName: string,
    prNumber: number,
  ): Promise<Array<{ name: string; status: string; conclusion: string | null; url?: string }>> {
    const [owner, repoName] = repoFullName.split("/");
    const { data: pr } = await this.octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    const { data } = await this.octokit.rest.checks.listForRef({
      owner,
      repo: repoName,
      ref: pr.head.sha,
    });
    return data.check_runs.map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
      url: run.details_url ?? undefined,
    }));
  }
}
