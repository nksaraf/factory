/**
 * Tests for Jira webhook trigger — payload parsing and status transition filtering.
 *
 * Uses Elysia's built-in test client (app.handle) to test the full handler,
 * mocking the database and workflow engine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────

// Mock the workflow engine
vi.mock("../../../lib/workflow-engine", () => ({
  startWorkflow: vi.fn(),
}));

// Mock workflow helpers
vi.mock("../../../lib/workflow-helpers", () => ({
  createWorkflowRun: vi.fn().mockResolvedValue({ workflowRunId: "wfr_mock" }),
}));

// Mock the god workflow
vi.mock("../workflows/god-workflow", () => ({
  godWorkflow: { name: "god-workflow" },
}));

// Mock id generation
vi.mock("../../../lib/id", () => ({
  newId: (prefix: string) => `${prefix}_test123`,
}));

// Mock adapter registry
vi.mock("../../../adapters/adapter-registry", () => ({
  getWorkTrackerAdapter: () => ({
    verifyWebhook: undefined, // skip verification
  }),
}));

import { jiraWebhookTrigger } from "./jira-webhook";
import { startWorkflow } from "../../../lib/workflow-engine";
import { createWorkflowRun } from "../../../lib/workflow-helpers";

// ── Test DB mock ────────────────────────────────────────

function createMockDb(providerRow: Record<string, unknown> | null) {
  // Chain: db.select().from().where().limit() → [row] or []
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(providerRow ? [providerRow] : []),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ workflowRunId: "wfr_test123" }]),
      }),
    }),
  } as any;
}

const DEFAULT_PROVIDER = {
  workTrackerProviderId: "prov_1",
  kind: "jira",
  apiUrl: "https://jira.example.com",
  credentialsRef: "cred_jira",
  spec: {
    defaultRepoFullName: "org/myrepo",
    defaultAgentId: "agent_1",
    gitHost: {
      type: "github",
      config: { token: "ghp_xxx" },
    },
    defaultBaseBranch: "main",
    workspaceTtl: "4h",
  },
};

// ── Helpers ──────────────────────────────────────────────

function buildJiraPayload(overrides?: {
  webhookEvent?: string;
  statusTo?: string;
  statusFrom?: string;
  issueKey?: string;
  field?: string;
}) {
  const {
    webhookEvent = "jira:issue_updated",
    statusTo = "In Progress",
    statusFrom = "To Do",
    issueKey = "PROJ-123",
    field = "status",
  } = overrides ?? {};

  return {
    webhookEvent,
    issue: {
      key: issueKey,
      fields: { summary: "Fix the thing" },
    },
    changelog: {
      items: [
        {
          field,
          fromString: statusFrom,
          toString: statusTo,
        },
      ],
    },
  };
}

async function sendWebhook(
  providerRow: Record<string, unknown> | null,
  payload: unknown,
) {
  const db = createMockDb(providerRow);
  const app = jiraWebhookTrigger(db);

  const res = await app.handle(
    new Request("http://localhost/webhooks/jira/prov_1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    db,
  };
}

// ── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Jira webhook trigger", () => {
  it("starts workflow on issue transition to In Progress", async () => {
    const { status, body } = await sendWebhook(DEFAULT_PROVIDER, buildJiraPayload());

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("workflow_started");
    expect(createWorkflowRun).toHaveBeenCalledOnce();
    expect(startWorkflow).toHaveBeenCalledOnce();
  });

  it("returns 404 when provider not found", async () => {
    const { status, body } = await sendWebhook(null, buildJiraPayload());

    expect(status).toBe(404);
    expect(body.error).toBe("provider_not_found");
  });

  it("ignores non-issue_updated events", async () => {
    const { body } = await sendWebhook(
      DEFAULT_PROVIDER,
      buildJiraPayload({ webhookEvent: "jira:issue_created" }),
    );

    expect(body.action).toBe("ignored");
    expect(body.reason).toBe("not_a_status_transition");
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it("ignores when no status change in changelog", async () => {
    const { body } = await sendWebhook(
      DEFAULT_PROVIDER,
      buildJiraPayload({ field: "assignee" }),
    );

    expect(body.action).toBe("ignored");
    expect(body.reason).toBe("no_status_change");
  });

  it("ignores status transitions to other statuses", async () => {
    const { body } = await sendWebhook(
      DEFAULT_PROVIDER,
      buildJiraPayload({ statusTo: "Done" }),
    );

    expect(body.action).toBe("ignored");
    expect(body.reason).toBe("status_changed_to_done");
  });

  it("handles the toString property correctly (not Object.prototype.toString)", async () => {
    // This is the critical test — Jira's changelog items have a property
    // literally named "toString" which shadows Object.prototype.toString.
    // The handler must use bracket notation to read it correctly.
    const payload = {
      webhookEvent: "jira:issue_updated",
      issue: { key: "TEST-1", fields: { summary: "Test" } },
      changelog: {
        items: [
          {
            field: "status",
            fromString: "To Do",
            // This is a plain string property, not the built-in toString method
            toString: "In Progress",
          },
        ],
      },
    };

    const { body } = await sendWebhook(DEFAULT_PROVIDER, payload);
    expect(body.action).toBe("workflow_started");
  });

  it("handles case-insensitive status matching", async () => {
    const { body } = await sendWebhook(
      DEFAULT_PROVIDER,
      buildJiraPayload({ statusTo: "IN PROGRESS" }),
    );

    expect(body.action).toBe("workflow_started");
  });

  it("ignores when provider has no default repo", async () => {
    const providerNoRepo = {
      ...DEFAULT_PROVIDER,
      spec: { ...DEFAULT_PROVIDER.spec, defaultRepoFullName: undefined },
    };

    const { body } = await sendWebhook(providerNoRepo, buildJiraPayload());

    expect(body.action).toBe("ignored");
    expect(body.reason).toBe("no_repo_mapping");
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it("returns 400 when issue key is missing", async () => {
    const payload = {
      webhookEvent: "jira:issue_updated",
      issue: { fields: { summary: "No key" } }, // missing `key`
      changelog: {
        items: [{ field: "status", toString: "In Progress" }],
      },
    };

    const { status, body } = await sendWebhook(DEFAULT_PROVIDER, payload);

    expect(status).toBe(400);
    expect(body.error).toBe("missing_issue_key");
  });

  it("passes correct workflow input structure", async () => {
    await sendWebhook(DEFAULT_PROVIDER, buildJiraPayload());

    const input = (createWorkflowRun as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(input.workflowName).toBe("god-workflow");
    expect(input.trigger).toBe("jira_webhook");
    expect(input.input).toMatchObject({
      issueKey: "PROJ-123",
      repoFullName: "org/myrepo",
      workTracker: {
        type: "jira",
        apiUrl: "https://jira.example.com",
        credentialsRef: "cred_jira",
      },
      agentId: "agent_1",
      baseBranch: "main",
    });
  });
});
