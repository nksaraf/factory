import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
  type TestApp,
} from "../test-helpers";
import type { PGlite } from "@electric-sql/pglite";

const BASE = "http://localhost/api/v1/factory/build/runs";

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: Record<string, unknown>) {
  return new Request(`${url}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Pipeline Run Controller", () => {
  let app: TestApp;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    app = ctx.app;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  async function createRun(overrides?: Record<string, unknown>) {
    const res = await app.handle(
      post(BASE, {
        triggerEvent: "push",
        triggerRef: "refs/heads/main",
        commitSha: "abc123",
        triggerActor: "testuser",
        ...overrides,
      })
    );
    return res;
  }

  // =========================================================================
  // Pipeline Run CRUD
  // =========================================================================
  describe("Pipeline Run CRUD", () => {
    it("POST /runs creates a pipeline run", async () => {
      const res = await createRun();
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.pipelineRunId).toBeTruthy();
      expect(data.triggerEvent).toBe("push");
      expect(data.triggerRef).toBe("refs/heads/main");
      expect(data.commitSha).toBe("abc123");
      expect(data.status).toBe("pending");
      expect(data.triggerActor).toBe("testuser");
    });

    it("GET /runs lists pipeline runs", async () => {
      await createRun({ commitSha: "sha1" });
      await createRun({ commitSha: "sha2" });

      const res = await app.handle(new Request(BASE));
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("GET /runs filters by status", async () => {
      await createRun({ commitSha: "sha1" });
      await createRun({ commitSha: "sha2" });

      const res = await app.handle(new Request(`${BASE}?status=pending`));
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);

      const res2 = await app.handle(new Request(`${BASE}?status=running`));
      const { data: data2 } = (await res2.json()) as any;
      expect(data2).toHaveLength(0);
    });

    it("GET /runs filters by triggerEvent", async () => {
      await createRun({ triggerEvent: "push", commitSha: "sha1" });
      await createRun({ triggerEvent: "pull_request", commitSha: "sha2", triggerRef: "refs/pull/1/head" });

      const res = await app.handle(new Request(`${BASE}?triggerEvent=push`));
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].triggerEvent).toBe("push");
    });

    it("GET /runs/:id returns a pipeline run with steps", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(new Request(`${BASE}/${created.pipelineRunId}`));
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.pipelineRunId).toBe(created.pipelineRunId);
      expect(data.steps).toEqual([]);
    });

    it("GET /runs/:id returns 404 for nonexistent", async () => {
      const res = await app.handle(new Request(`${BASE}/nonexistent`));
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Status Updates
  // =========================================================================
  describe("Status Updates", () => {
    it("POST /runs/:id/update updates pipeline run status", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        patch(`${BASE}/${created.pipelineRunId}`, {
          status: "running",
          startedAt: "2026-03-28T10:00:00Z",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("running");
      expect(data.startedAt).toBeTruthy();
    });

    it("POST /runs/:id/update returns 404 for nonexistent", async () => {
      const res = await app.handle(
        patch(`${BASE}/nonexistent`, { status: "running" })
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Cancel
  // =========================================================================
  describe("Cancel", () => {
    it("POST /runs/:id/cancel cancels a pending run", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/${created.pipelineRunId}/cancel`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("cancelled");
      expect(data.completedAt).toBeTruthy();
    });

    it("POST /runs/:id/cancel returns 404 for already completed run", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      // First, complete it
      await app.handle(
        patch(`${BASE}/${created.pipelineRunId}`, {
          status: "success",
          completedAt: "2026-03-28T10:05:00Z",
        })
      );

      // Try to cancel
      const res = await app.handle(
        post(`${BASE}/${created.pipelineRunId}/cancel`, {})
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Step Runs
  // =========================================================================
  describe("Step Runs", () => {
    it("POST /runs/:id/steps creates a step run", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/${created.pipelineRunId}/steps`, {
          jobName: "build",
          stepName: "Install dependencies",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.pipelineStepRunId).toBeTruthy();
      expect(data.jobName).toBe("build");
      expect(data.stepName).toBe("Install dependencies");
      expect(data.status).toBe("pending");
    });

    it("POST /runs/:id/steps/:stepId/update updates a step run", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      const stepRes = await app.handle(
        post(`${BASE}/${created.pipelineRunId}/steps`, {
          jobName: "test",
        })
      );
      const { data: step } = (await stepRes.json()) as any;

      const res = await app.handle(
        patch(`${BASE}/${created.pipelineRunId}/steps/${step.pipelineStepRunId}`, {
          status: "success",
          exitCode: 0,
          completedAt: "2026-03-28T10:05:00Z",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("success");
      expect(data.exitCode).toBe(0);
    });

    it("GET /runs/:id includes steps in response", async () => {
      const createRes = await createRun();
      const { data: created } = (await createRes.json()) as any;

      await app.handle(
        post(`${BASE}/${created.pipelineRunId}/steps`, { jobName: "build" })
      );
      await app.handle(
        post(`${BASE}/${created.pipelineRunId}/steps`, { jobName: "test" })
      );

      const res = await app.handle(new Request(`${BASE}/${created.pipelineRunId}`));
      const { data } = (await res.json()) as any;
      expect(data.steps).toHaveLength(2);
      expect(data.steps[0].jobName).toBe("build");
      expect(data.steps[1].jobName).toBe("test");
    });

    it("POST /runs/:id/steps returns 404 for nonexistent run", async () => {
      const res = await app.handle(
        post(`${BASE}/nonexistent/steps`, { jobName: "build" })
      );
      expect(res.status).toBe(404);
    });
  });
});
