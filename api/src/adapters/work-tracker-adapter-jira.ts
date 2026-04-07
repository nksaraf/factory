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
 * - updateIssueStatus: POST /rest/api/3/issue/{issueId}/transitions
 */
export class JiraWorkTrackerAdapter implements WorkTrackerAdapter {
  readonly type = "jira";

  private headers(credentialsRef: string): Record<string, string> {
    return {
      Authorization: `Basic ${credentialsRef}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async testConnection(
    apiUrl: string,
    credentialsRef: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${apiUrl}/rest/api/3/myself`, {
        headers: this.headers(credentialsRef),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async listProjects(
    apiUrl: string,
    credentialsRef: string,
  ): Promise<ExternalProject[]> {
    const res = await fetch(`${apiUrl}/rest/api/3/project`, {
      headers: this.headers(credentialsRef),
    });
    if (!res.ok) throw new Error(`Jira listProjects failed: ${res.status}`);
    const data = (await res.json()) as Array<{ id: string; key: string; name: string }>;
    return data.map((p) => ({ id: p.id, key: p.key, name: p.name }));
  }

  async fetchIssues(
    apiUrl: string,
    credentialsRef: string,
    projectId: string,
    filterQuery?: string,
  ): Promise<ExternalIssue[]> {
    const jql = filterQuery ?? `project = ${projectId} ORDER BY updated DESC`;
    const res = await fetch(`${apiUrl}/rest/api/3/search`, {
      method: "POST",
      headers: this.headers(credentialsRef),
      body: JSON.stringify({
        jql,
        maxResults: 100,
        fields: [
          "summary", "description", "status", "issuetype",
          "priority", "assignee", "labels", "parent", "created", "updated",
        ],
      }),
    });
    if (!res.ok) throw new Error(`Jira fetchIssues failed: ${res.status}`);
    const data = (await res.json()) as { issues: JiraIssueRaw[] };
    return data.issues.map((i) => this.mapIssue(apiUrl, i));
  }

  async getIssue(
    apiUrl: string,
    credentialsRef: string,
    issueId: string,
  ): Promise<ExternalIssue> {
    const res = await fetch(`${apiUrl}/rest/api/3/issue/${issueId}`, {
      headers: this.headers(credentialsRef),
    });
    if (!res.ok) throw new Error(`Jira getIssue failed: ${res.status}`);
    const data = (await res.json()) as JiraIssueRaw;
    return this.mapIssue(apiUrl, data);
  }

  async pushIssue(
    apiUrl: string,
    credentialsRef: string,
    projectId: string,
    spec: PushWorkItemSpec,
  ): Promise<PushResult> {
    const res = await fetch(`${apiUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: this.headers(credentialsRef),
      body: JSON.stringify({
        fields: {
          project: { id: projectId },
          summary: spec.title,
          description: spec.description
            ? { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: spec.description }] }] }
            : undefined,
          issuetype: { name: spec.kind },
          priority: spec.priority ? { name: spec.priority } : undefined,
          labels: spec.labels ?? [],
          parent: spec.parentExternalId ? { key: spec.parentExternalId } : undefined,
        },
      }),
    });
    if (!res.ok) throw new Error(`Jira pushIssue failed: ${res.status}`);
    const data = (await res.json()) as { id: string; key: string; self: string };
    return {
      externalId: data.id,
      externalKey: data.key,
      externalUrl: `${apiUrl}/browse/${data.key}`,
    };
  }

  async pushIssues(
    apiUrl: string,
    credentialsRef: string,
    projectId: string,
    specs: PushWorkItemSpec[],
  ): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (const spec of specs) {
      results.push(await this.pushIssue(apiUrl, credentialsRef, projectId, spec));
    }
    return results;
  }

  async updateIssueStatus(
    apiUrl: string,
    credentialsRef: string,
    issueId: string,
    transitionName: string,
  ): Promise<void> {
    // First, get available transitions
    const transRes = await fetch(
      `${apiUrl}/rest/api/3/issue/${issueId}/transitions`,
      { headers: this.headers(credentialsRef) },
    );
    if (!transRes.ok) throw new Error(`Jira getTransitions failed: ${transRes.status}`);
    const transData = (await transRes.json()) as {
      transitions: Array<{ id: string; name: string }>;
    };

    const transition = transData.transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
    );
    if (!transition) {
      const available = transData.transitions.map((t) => t.name).join(", ");
      throw new Error(
        `Jira transition "${transitionName}" not available for ${issueId}. Available: ${available}`,
      );
    }

    // Execute the transition
    const res = await fetch(
      `${apiUrl}/rest/api/3/issue/${issueId}/transitions`,
      {
        method: "POST",
        headers: this.headers(credentialsRef),
        body: JSON.stringify({ transition: { id: transition.id } }),
      },
    );
    if (!res.ok) throw new Error(`Jira transition failed: ${res.status}`);
  }

  async verifyWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<{ valid: boolean; eventType: string; payload: Record<string, unknown> }> {
    // Jira Cloud webhooks use a shared secret in the webhook URL or
    // an HMAC signature header. For now, parse the event type from the payload.
    const payload = JSON.parse(body) as Record<string, unknown>;
    const eventType = (payload.webhookEvent as string) ?? "unknown";
    // TODO: implement HMAC verification when webhook secret is configured
    return { valid: true, eventType, payload };
  }

  private mapIssue(apiUrl: string, raw: JiraIssueRaw): ExternalIssue {
    const f = raw.fields;
    return {
      id: raw.id,
      key: raw.key,
      title: f.summary,
      description: this.extractDescription(f.description),
      status: f.status?.name ?? "Unknown",
      kind: f.issuetype?.name ?? "Task",
      priority: f.priority?.name ?? null,
      assignee: f.assignee?.displayName ?? null,
      labels: f.labels ?? [],
      parentId: f.parent?.key ?? null,
      url: `${apiUrl}/browse/${raw.key}`,
      createdAt: f.created,
      updatedAt: f.updated,
    };
  }

  private extractDescription(desc: unknown): string | null {
    if (!desc) return null;
    if (typeof desc === "string") return desc;
    // ADF (Atlassian Document Format) — extract plain text
    if (typeof desc === "object" && desc !== null && "content" in desc) {
      return this.adfToPlainText(desc);
    }
    return null;
  }

  private adfToPlainText(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text" && n.text) return n.text;
    if (Array.isArray(n.content)) {
      return n.content.map((c) => this.adfToPlainText(c)).join("");
    }
    return "";
  }
}

// ── Jira API response types ───────────────────────────────

interface JiraIssueRaw {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: unknown;
    status?: { name: string };
    issuetype?: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string };
    labels?: string[];
    parent?: { key: string };
    created: string;
    updated: string;
  };
}
