import type {
  WorkTrackerAdapter,
  ExternalProject,
  ExternalIssue,
  PushWorkItemSpec,
  PushResult,
} from "./work-tracker-adapter";

/**
 * JIRA REST API v3 adapter
 *
 * API endpoints used:
 * - testConnection: GET /rest/api/3/myself
 * - listProjects: GET /rest/api/3/project
 * - fetchIssues: POST /rest/api/3/search (JQL)
 * - getIssue: GET /rest/api/3/issue/{issueId}
 * - pushIssue: POST /rest/api/3/issue
 * - pushIssues: POST /rest/api/3/issue/bulk
 */
export class JiraWorkTrackerAdapter implements WorkTrackerAdapter {
  readonly type = "jira";

  async testConnection(
    _apiUrl: string,
    _credentialsRef: string
  ): Promise<{ ok: boolean; error?: string }> {
    throw new Error("JIRA adapter not yet implemented");
  }

  async listProjects(
    _apiUrl: string,
    _credentialsRef: string
  ): Promise<ExternalProject[]> {
    throw new Error("JIRA adapter not yet implemented");
  }

  async fetchIssues(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    _filterQuery?: string
  ): Promise<ExternalIssue[]> {
    throw new Error("JIRA adapter not yet implemented");
  }

  async getIssue(
    _apiUrl: string,
    _credentialsRef: string,
    _issueId: string
  ): Promise<ExternalIssue> {
    throw new Error("JIRA adapter not yet implemented");
  }

  async pushIssue(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    _spec: PushWorkItemSpec
  ): Promise<PushResult> {
    throw new Error("JIRA adapter not yet implemented");
  }

  async pushIssues(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    _specs: PushWorkItemSpec[]
  ): Promise<PushResult[]> {
    throw new Error("JIRA adapter not yet implemented");
  }
}
