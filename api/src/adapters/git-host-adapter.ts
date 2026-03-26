export interface GitHostRepoInfo {
  externalId: string;
  fullName: string;
  name: string;
  defaultBranch: string;
  gitUrl: string;
  isPrivate: boolean;
  description?: string;
  language?: string;
  topics?: string[];
}

export interface GitHostCollaborator {
  externalUserId: string;
  login: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface GitHostCommitStatus {
  state: "pending" | "success" | "failure" | "error";
  targetUrl: string;
  description: string;
  context: string;
}

export interface GitHostCheckRun {
  name: string;
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "timed_out";
  detailsUrl?: string;
  output?: { title: string; summary: string };
}

export interface GitHostPullRequest {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  head: string;
  base: string;
  url: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  author: { login: string };
  checksStatus?: "pending" | "success" | "failure";
}

export interface GitHostPullRequestCreate {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface WebhookVerification {
  valid: boolean;
  eventType: string;
  deliveryId: string;
  action?: string;
  payload: Record<string, unknown>;
}

export interface GitHostAdapter {
  readonly hostType: string;
  getAccessToken(): Promise<string>;
  listRepos(): Promise<GitHostRepoInfo[]>;
  getRepo(externalId: string): Promise<GitHostRepoInfo | null>;
  listOrgMembers(): Promise<GitHostCollaborator[]>;
  listCollaborators(
    repoFullName: string,
  ): Promise<GitHostCollaborator[]>;
  verifyWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookVerification>;
  createWebhook(
    repoFullName: string,
    callbackUrl: string,
    events: string[],
  ): Promise<{ webhookId: string }>;
  deleteWebhook(
    repoFullName: string,
    webhookId: string,
  ): Promise<void>;
  postCommitStatus(
    repoFullName: string,
    sha: string,
    status: GitHostCommitStatus,
  ): Promise<void>;
  createCheckRun(
    repoFullName: string,
    check: GitHostCheckRun,
  ): Promise<{ checkRunId: string }>;
  updateCheckRun(
    repoFullName: string,
    checkRunId: string,
    update: Partial<GitHostCheckRun>,
  ): Promise<void>;
  listPullRequests(
    repoFullName: string,
    filters?: { state?: "open" | "closed" | "all" },
  ): Promise<GitHostPullRequest[]>;
  getPullRequest(
    repoFullName: string,
    prNumber: number,
  ): Promise<GitHostPullRequest | null>;
  createPullRequest(
    repoFullName: string,
    pr: GitHostPullRequestCreate,
  ): Promise<GitHostPullRequest>;
  mergePullRequest(
    repoFullName: string,
    prNumber: number,
    method?: "merge" | "squash" | "rebase",
  ): Promise<void>;
  getPullRequestChecks(
    repoFullName: string,
    prNumber: number,
  ): Promise<
    Array<{
      name: string;
      status: string;
      conclusion: string | null;
      url?: string;
    }>
  >;
}
