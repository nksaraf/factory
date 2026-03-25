import { logger } from "../logger";
import type {
  WorkTrackerAdapter,
  ExternalProject,
  ExternalIssue,
  PushWorkItemSpec,
  PushResult,
} from "./work-tracker-adapter";

export class NoopWorkTrackerAdapter implements WorkTrackerAdapter {
  readonly type = "noop";

  async testConnection(
    _apiUrl: string,
    _credentialsRef: string
  ): Promise<{ ok: boolean; error?: string }> {
    logger.debug("noop work tracker: testConnection");
    return { ok: true };
  }

  async listProjects(
    _apiUrl: string,
    _credentialsRef: string
  ): Promise<ExternalProject[]> {
    logger.debug("noop work tracker: listProjects");
    return [];
  }

  async fetchIssues(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string
  ): Promise<ExternalIssue[]> {
    logger.debug("noop work tracker: fetchIssues");
    return [];
  }

  async getIssue(
    _apiUrl: string,
    _credentialsRef: string,
    issueId: string
  ): Promise<ExternalIssue> {
    throw new Error(`noop work tracker: issue ${issueId} not found`);
  }

  async pushIssue(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    spec: PushWorkItemSpec
  ): Promise<PushResult> {
    logger.debug({ title: spec.title }, "noop work tracker: pushIssue");
    return { externalId: "noop-id", externalKey: "NOOP-0", externalUrl: "" };
  }

  async pushIssues(
    _apiUrl: string,
    _credentialsRef: string,
    _projectId: string,
    specs: PushWorkItemSpec[]
  ): Promise<PushResult[]> {
    logger.debug({ count: specs.length }, "noop work tracker: pushIssues");
    return specs.map((_, i) => ({
      externalId: `noop-id-${i}`,
      externalKey: `NOOP-${i}`,
      externalUrl: "",
    }));
  }
}
