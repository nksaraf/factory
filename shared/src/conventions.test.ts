import { describe, expect, it } from "vitest";

import {
  checkConnectionPolicy,
  checkDeployGates,
  validateBranchName,
  validateCommitMessage,
} from "./conventions";
import {
  defaultConventionsConfig,
  normalizeConventionsConfig,
} from "./conventions-schema";

describe("default conventions", () => {
  it("is permissive for branch and commit", () => {
    const c = defaultConventionsConfig();
    expect(validateBranchName("anything/goes", c).valid).toBe(true);
    expect(validateCommitMessage("not conventional", c).valid).toBe(true);
  });
});

describe("validateBranchName", () => {
  it("accepts feature/BILL-123-test when configured", () => {
    const c = normalizeConventionsConfig({
      branches: {
        pattern: "{type}/{ticket}-{slug}",
        types: ["feature", "hotfix"],
        require_ticket: true,
      },
    });
    expect(validateBranchName("feature/BILL-123-test", c).valid).toBe(true);
    expect(validateBranchName("wip/bad", c).valid).toBe(false);
  });
});

describe("validateCommitMessage", () => {
  it("enforces conventional commits when format is conventional", () => {
    const c = normalizeConventionsConfig({
      commits: { format: "conventional", require_scope: false },
    });
    expect(validateCommitMessage("feat: ok", c).valid).toBe(true);
    expect(validateCommitMessage("bad message", c).valid).toBe(false);
  });

  it("requires scope when require_scope", () => {
    const c = normalizeConventionsConfig({
      commits: { format: "conventional", require_scope: true },
    });
    expect(validateCommitMessage("feat(api): ok", c).valid).toBe(true);
    expect(validateCommitMessage("feat: no scope", c).valid).toBe(false);
  });
});

describe("checkConnectionPolicy", () => {
  it("allows everything with no rules (permissive default)", () => {
    const c = defaultConventionsConfig();
    const r = checkConnectionPolicy("staging", false, c);
    expect(r.allowed).toBe(true);
    expect(r.forceReadonly).toBe(false);
  });

  it("allows matching kind", () => {
    const c = normalizeConventionsConfig({
      connections: {
        allow: [{ kind: "sandbox" }, { kind: "staging" }],
      },
    });
    expect(checkConnectionPolicy("staging", false, c).allowed).toBe(true);
    expect(checkConnectionPolicy("sandbox", false, c).allowed).toBe(true);
  });

  it("denies unmatched kind", () => {
    const c = normalizeConventionsConfig({
      connections: {
        allow: [{ kind: "sandbox" }],
      },
    });
    const r = checkConnectionPolicy("production", false, c);
    expect(r.allowed).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it("forces readonly on production when configured", () => {
    const c = normalizeConventionsConfig({
      connections: {
        allow: [
          { kind: "staging" },
          { kind: "production", force_readonly: true },
        ],
      },
    });
    const rw = checkConnectionPolicy("production", false, c);
    expect(rw.allowed).toBe(false);
    expect(rw.forceReadonly).toBe(true);

    const ro = checkConnectionPolicy("production", true, c);
    expect(ro.allowed).toBe(true);
    expect(ro.forceReadonly).toBe(true);
  });

  it("requires reason for production connections by default", () => {
    const c = defaultConventionsConfig();
    const r = checkConnectionPolicy("production", true, c);
    expect(r.requireReason).toBe(true);
  });

  it("does not require reason for non-production", () => {
    const c = defaultConventionsConfig();
    const r = checkConnectionPolicy("staging", false, c);
    expect(r.requireReason).toBe(false);
  });
});

describe("checkDeployGates", () => {
  it("returns valid when tier has no gates", () => {
    const c = defaultConventionsConfig();
    expect(checkDeployGates("production", c).valid).toBe(true);
  });

  it("flags missing tests when configured", () => {
    const c = normalizeConventionsConfig({
      deploy: {
        production: { require_passing_tests: true },
      },
    });
    const r = checkDeployGates("production", c, { testsPassing: false });
    expect(r.valid).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });
});
