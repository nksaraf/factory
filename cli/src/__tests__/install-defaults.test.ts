import { describe, expect, it } from "vitest";

import { collectDefaults } from "../handlers/install/defaults/index.js";
import type { DefaultsScanResult } from "../handlers/install/defaults/types.js";

describe("collectDefaults", () => {
  it("returns a scan result for workbench role", async () => {
    const scan = await collectDefaults("workbench");
    expect(scan.all.length).toBeGreaterThan(0);
    expect(scan.pending.length + scan.applied.length).toBe(scan.all.length);

    // Should include git defaults
    const gitChanges = scan.all.filter((c) => c.category === "git");
    expect(gitChanges.length).toBeGreaterThan(0);

    // Should include npm defaults for workbench
    const npmChanges = scan.all.filter((c) => c.category === "npm");
    expect(npmChanges.length).toBeGreaterThan(0);
  });

  it("returns fewer providers for site role (no npm/curl/psql)", async () => {
    const workbench = await collectDefaults("workbench");
    const site = await collectDefaults("site");

    // Site should have fewer total changes (no npm, curl, psql, shell)
    expect(site.all.length).toBeLessThan(workbench.all.length);

    // Site should NOT have npm defaults
    const siteNpm = site.all.filter((c) => c.category === "npm");
    expect(siteNpm.length).toBe(0);

    // Site SHOULD have git defaults
    const siteGit = site.all.filter((c) => c.category === "git");
    expect(siteGit.length).toBeGreaterThan(0);
  });

  it("every change has required fields", async () => {
    const scan = await collectDefaults("workbench");
    for (const change of scan.all) {
      expect(change.id).toBeTruthy();
      expect(change.category).toBeTruthy();
      expect(change.description).toBeTruthy();
      expect(change.target).toBeTruthy();
      expect(change.proposedValue).toBeTruthy();
      expect(typeof change.alreadyApplied).toBe("boolean");
      expect(typeof change.requiresSudo).toBe("boolean");
      expect(typeof change.apply).toBe("function");
    }
  });

  it("marks already-applied changes correctly", async () => {
    const scan = await collectDefaults("workbench");
    // On a developer machine, some git configs may already be set
    // Just verify the categorization is consistent
    for (const change of scan.applied) {
      expect(change.alreadyApplied).toBe(true);
    }
    for (const change of scan.pending) {
      expect(change.alreadyApplied).toBe(false);
    }
  });

  it("git provider detects init.defaultBranch", async () => {
    const scan = await collectDefaults("workbench");
    const defaultBranch = scan.all.find((c) => c.id === "git:init.defaultBranch");
    expect(defaultBranch).toBeDefined();
    expect(defaultBranch!.proposedValue).toBe("main");
  });
});
