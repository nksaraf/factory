/**
 * WorkTrackerAdapter — interface for external work-tracking providers (JIRA, Linear, etc.)
 *
 * Analogous to ProviderAdapter for infra providers.
 * Stateless: receives connection details per call.
 */

export type WorkTrackerType = "jira" | "linear" | "noop";

export interface ExternalProject {
  id: string;
  key: string;
  name: string;
}

export interface ExternalIssue {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  status: string;
  kind: string;
  priority?: string | null;
  assignee?: string | null;
  labels: string[];
  parentId?: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PushWorkItemSpec {
  title: string;
  description?: string;
  kind: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  parentExternalId?: string;
}

export interface PushResult {
  externalId: string;
  externalKey: string;
  externalUrl: string;
}

export interface WorkTrackerSyncResult {
  created: number;
  updated: number;
  total: number;
}

export interface WorkTrackerAdapter {
  readonly type: string;

  testConnection(
    apiUrl: string,
    credentialsRef: string
  ): Promise<{ ok: boolean; error?: string }>;
  listProjects(
    apiUrl: string,
    credentialsRef: string
  ): Promise<ExternalProject[]>;
  fetchIssues(
    apiUrl: string,
    credentialsRef: string,
    projectId: string,
    filterQuery?: string
  ): Promise<ExternalIssue[]>;
  getIssue(
    apiUrl: string,
    credentialsRef: string,
    issueId: string
  ): Promise<ExternalIssue>;
  pushIssue(
    apiUrl: string,
    credentialsRef: string,
    projectId: string,
    spec: PushWorkItemSpec
  ): Promise<PushResult>;
  pushIssues(
    apiUrl: string,
    credentialsRef: string,
    projectId: string,
    specs: PushWorkItemSpec[]
  ): Promise<PushResult[]>;
  updateIssueStatus(
    apiUrl: string,
    credentialsRef: string,
    issueId: string,
    transitionName: string,
  ): Promise<void>;
  verifyWebhook?(
    headers: Record<string, string>,
    body: string,
  ): Promise<{ valid: boolean; eventType: string; payload: Record<string, unknown> }>;
}
