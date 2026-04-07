import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
} from "../test-helpers";
import * as pipelineRunSvc from "../services/build/pipeline-run.service";
import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";
import type { PipelineRunSpec } from "@smp/factory-shared/schemas/build";

// The service stores extra fields in the spec JSONB beyond the base PipelineRunSpec.
// startedAt/completedAt are stored as ISO strings in JSONB, overriding the Date type.
interface PipelineRunSpecStored extends Omit<PipelineRunSpec, "startedAt" | "completedAt"> {
  triggerEvent?: string;
  triggerRef?: string;
  triggerActor?: string;
  startedAt?: string;
  completedAt?: string;
}

interface PipelineStepSpecStored {
  jobName?: string;
  stepName?: string;
}

describe("Pipeline Run Service (v2)", () => {
  let db: Database;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    db = ctx.db as unknown as Database;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  async function createRun(overrides?: Partial<pipelineRunSvc.CreatePipelineRunInput>) {
    return pipelineRunSvc.createPipelineRun(db, {
      triggerEvent: "push",
      triggerRef: "refs/heads/main",
      commitSha: "abc123",
      triggerActor: "testuser",
      ...overrides,
    });
  }

  // =========================================================================
  // Pipeline Run CRUD
  // =========================================================================
  describe("Pipeline Run CRUD", () => {
    it("createPipelineRun creates a pipeline run", async () => {
      const run = await createRun();
      expect(run.id).toBeTruthy();
      const spec = run.spec as PipelineRunSpecStored;
      expect(spec.triggerEvent).toBe("push");
      expect(spec.triggerRef).toBe("refs/heads/main");
      expect(run.commitSha).toBe("abc123");
      expect(run.status).toBe("pending");
    });

    it("listPipelineRuns lists pipeline runs", async () => {
      await createRun({ commitSha: "sha1" });
      await createRun({ commitSha: "sha2" });

      const runs = await pipelineRunSvc.listPipelineRuns(db);
      expect(runs).toHaveLength(2);
    });

    it("getPipelineRun returns a pipeline run by id", async () => {
      const created = await createRun();

      const fetched = await pipelineRunSvc.getPipelineRun(db, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    it("getPipelineRun returns null for nonexistent", async () => {
      const result = await pipelineRunSvc.getPipelineRun(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Updates
  // =========================================================================
  describe("Updates", () => {
    it("updatePipelineRun updates pipeline run status", async () => {
      const created = await createRun();

      const updated = await pipelineRunSvc.updatePipelineRun(db, created.id, {
        status: "running",
        startedAt: new Date("2026-03-28T10:00:00Z"),
      });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("running");
      const spec = updated!.spec as PipelineRunSpecStored;
      expect(spec.startedAt).toBeTruthy();
    });

    it("updatePipelineRun returns null for nonexistent", async () => {
      const result = await pipelineRunSvc.updatePipelineRun(db, "nonexistent", {
        status: "running",
      });
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Actions
  // =========================================================================
  describe("Actions", () => {
    it("cancelPipelineRun cancels a pending run", async () => {
      const created = await createRun();

      const cancelled = await pipelineRunSvc.cancelPipelineRun(db, created.id);
      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe("cancelled");
    });
  });

  // =========================================================================
  // Relations: Steps
  // =========================================================================
  describe("Steps (relation)", () => {
    it("listStepRuns returns empty for run with no steps", async () => {
      const created = await createRun();

      const steps = await pipelineRunSvc.listStepRuns(db, created.id);
      expect(steps).toEqual([]);
    });

    it("createStepRun creates a step for a run", async () => {
      const run = await createRun();
      const step = await pipelineRunSvc.createStepRun(db, {
        pipelineRunId: run.id,
        jobName: "build",
        stepName: "checkout",
      });

      expect(step.id).toBeTruthy();
      const spec = step.spec as PipelineStepSpecStored;
      expect(spec.jobName).toBe("build");
      expect(spec.stepName).toBe("checkout");

      const steps = await pipelineRunSvc.listStepRuns(db, run.id);
      expect(steps).toHaveLength(1);
    });
  });
});
