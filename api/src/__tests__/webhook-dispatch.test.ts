import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";
import { WebhookService } from "../modules/build/webhook.service";
import { GitHostService } from "../modules/build/git-host.service";
import * as previewSvc from "../services/preview/preview.service";
import * as gitHostProviderSvc from "../services/build/git-host-provider.service";

import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Webhook Dispatch — Preview Lifecycle", () => {
  let db: Database;
  let client: PGlite;
  let webhookService: WebhookService;

  beforeAll(async () => {
    const ctx = await createTestContext();
    db = ctx.db as unknown as Database;
    client = ctx.client;

    const gitHostService = new GitHostService(db);
    webhookService = new WebhookService(db, gitHostService);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  // Helper: call the private dispatchEvent via processWebhook with a noop adapter
  async function dispatchPREvent(action: string, overrides?: Record<string, unknown>) {
    const payload = {
      action,
      pull_request: {
        number: 42,
        title: "Fix auth bug",
        head: {
          ref: "feat/auth-fix",
          sha: "abc123def456",
        },
        ...(overrides?.pull_request as Record<string, unknown> ?? {}),
      },
      repository: {
        full_name: "myorg/myrepo",
        ...(overrides?.repository as Record<string, unknown> ?? {}),
      },
      sender: {
        login: "testuser",
        ...(overrides?.sender as Record<string, unknown> ?? {}),
      },
    };

    // Access dispatchEvent directly since processWebhook needs adapter verification
    // We'll test the dispatch logic by calling it on the service instance
    const svc = webhookService as any;
    await svc.dispatchEvent("pull_request", action, payload);
  }

  describe("pull_request.opened", () => {
    it("creates a preview on PR opened", async () => {
      await dispatchPREvent("opened");

      const previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(1);
      expect(previews[0].prNumber).toBe(42);
      expect(previews[0].sourceBranch).toBe("feat/auth-fix");
      expect(previews[0].commitSha).toBe("abc123def456");
      expect(previews[0].repo).toBe("myorg/myrepo");
      expect(previews[0].status).toBe("building");
    });

    it("creates a preview on PR reopened", async () => {
      await dispatchPREvent("reopened");

      const previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(1);
      expect(previews[0].prNumber).toBe(42);
    });
  });

  describe("pull_request.synchronize", () => {
    it("updates commit SHA when PR is pushed to", async () => {
      // First create a preview
      await dispatchPREvent("opened");

      // Then simulate a push to the PR
      await dispatchPREvent("synchronize", {
        pull_request: {
          number: 42,
          title: "Fix auth bug",
          head: {
            ref: "feat/auth-fix",
            sha: "newsha789",
          },
        },
      });

      const previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(1);
      expect(previews[0].commitSha).toBe("newsha789");
      expect(previews[0].status).toBe("building");
    });

    it("does nothing if no matching preview exists", async () => {
      // No error expected — just a no-op
      await dispatchPREvent("synchronize");
      const previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(0);
    });
  });

  describe("pull_request.closed", () => {
    it("expires preview when PR is closed", async () => {
      // Create a preview first
      await dispatchPREvent("opened");

      let previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(1);
      expect(previews[0].status).toBe("building");

      // Close the PR
      await dispatchPREvent("closed");

      previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(1);
      expect(previews[0].status).toBe("expired");
    });

    it("does nothing if no matching preview exists", async () => {
      await dispatchPREvent("closed");
      const previews = await previewSvc.listPreviews(db);
      expect(previews).toHaveLength(0);
    });
  });

  describe("push events", () => {
    it("handles push events without error", async () => {
      const svc = webhookService as any;
      // Push events are currently a no-op placeholder
      await expect(
        svc.dispatchEvent("push", undefined, {
          ref: "refs/heads/main",
          after: "sha123",
          repository: { full_name: "myorg/myrepo" },
        })
      ).resolves.toBeUndefined();
    });
  });
});
