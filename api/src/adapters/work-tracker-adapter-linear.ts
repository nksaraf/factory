import type {
  WorkTrackerAdapter,
  ExternalProject,
  ExternalIssue,
  PushWorkItemSpec,
  PushResult,
} from "./work-tracker-adapter";

/**
 * Linear GraphQL API adapter
 *
 * API operations:
 * - testConnection: query { viewer { id } }
 * - listProjects: query { teams { nodes { id key name } } }
 * - fetchIssues: query { issues(filter: ...) { nodes { ... } } }
 * - getIssue: query { issue(id: ...) { ... } }
 * - pushIssue: mutation { issueCreate(...) { ... } }
 * - pushIssues: sequential issueCreate mutations
 */
export class LinearWorkTrackerAdapter implements WorkTrackerAdapter {
  readonly type = "linear";

  async testConnection(
    _apiUrl: string,
    _credentialsRef: string
  ): Promise<{ ok: boolean; error?: string }> {
    throw new Error("Linear adapter not yet implemented");
  }

  async listProjects(
    _apiUrl: string,
    _credentialsRef: string
  ): Promise<ExternalProject[]> {
    throw new Error("Linear adapter not yet implemented");
  }

  async fetchIssues(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    _filterQuery?: string
  ): Promise<ExternalIssue[]> {
    throw new Error("Linear adapter not yet implemented");
  }

  async getIssue(
    _apiUrl: string,
    _credentialsRef: string,
    _issueId: string
  ): Promise<ExternalIssue> {
    throw new Error("Linear adapter not yet implemented");
  }

  async pushIssue(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    _spec: PushWorkItemSpec
  ): Promise<PushResult> {
    throw new Error("Linear adapter not yet implemented");
  }

  async pushIssues(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    _specs: PushWorkItemSpec[]
  ): Promise<PushResult[]> {
    throw new Error("Linear adapter not yet implemented");
  }
}
