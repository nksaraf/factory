import { mkdtempSync, existsSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  generateHookScript,
  installHooks,
  verifyHooks,
  hooksHealthy,
  HOOK_NAMES,
} from "../lib/hooks.js";

// Each test gets a fresh git repo in /tmp
function createGitRepo(label: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `dx-hooks-${label}-`));
  spawnSync("git", ["init", dir], { stdio: "ignore" });
  return dir;
}

describe("hooks", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  // ── generateHookScript ────────────────────────────────

  describe("generateHookScript", () => {
    it("returns a POSIX sh script for each hook", () => {
      for (const name of HOOK_NAMES) {
        const script = generateHookScript(name);
        expect(script).toMatch(/^#!\/bin\/sh/);
      }
    });

    it("commit-msg script delegates to dx git-hook commit-msg", () => {
      const script = generateHookScript("commit-msg");
      expect(script).toContain('exec dx git-hook commit-msg "$1"');
    });

    it("pre-push script delegates to dx git-hook pre-push", () => {
      const script = generateHookScript("pre-push");
      expect(script).toContain("exec dx git-hook pre-push");
    });

    it("post-checkout only runs on branch checkout", () => {
      const script = generateHookScript("post-checkout");
      expect(script).toContain('[ "$3" = "1" ] || exit 0');
    });
  });

  // ── installHooks ──────────────────────────────────────

  describe("installHooks", () => {
    it("installs all 5 hooks into .dx/hooks/", () => {
      const dir = createGitRepo("install");
      dirs.push(dir);

      const result = installHooks(dir);

      expect(result.installed).toHaveLength(5);
      expect(result.updated).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);

      for (const name of HOOK_NAMES) {
        const hookPath = path.join(dir, ".dx", "hooks", name);
        expect(existsSync(hookPath)).toBe(true);
        // Check executable permission
        const stat = statSync(hookPath);
        expect(stat.mode & 0o111).toBeGreaterThan(0);
      }
    });

    it("sets core.hooksPath to .dx/hooks", () => {
      const dir = createGitRepo("hookspath");
      dirs.push(dir);

      installHooks(dir);

      const result = spawnSync("git", ["config", "--get", "core.hooksPath"], {
        cwd: dir,
        encoding: "utf-8",
      });
      expect(result.stdout.trim()).toBe(".dx/hooks");
    });

    it("reports unchanged on second install", () => {
      const dir = createGitRepo("idempotent");
      dirs.push(dir);

      installHooks(dir);
      const result = installHooks(dir);

      expect(result.installed).toHaveLength(0);
      expect(result.updated).toHaveLength(0);
      expect(result.unchanged).toHaveLength(5);
    });

    it("reports updated when hook content changes", () => {
      const dir = createGitRepo("update");
      dirs.push(dir);

      installHooks(dir);

      // Tamper with one hook
      const hookPath = path.join(dir, ".dx", "hooks", "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\necho custom\n");

      const result = installHooks(dir);
      expect(result.updated).toContain("pre-commit");
      expect(result.installed).toHaveLength(0);
      // The other 4 should be unchanged
      expect(result.unchanged).toHaveLength(4);
    });
  });

  // ── verifyHooks ───────────────────────────────────────

  describe("verifyHooks", () => {
    it("reports all missing before install", () => {
      const dir = createGitRepo("verify-missing");
      dirs.push(dir);

      const v = verifyHooks(dir);
      expect(v.hooksPathSet).toBe(false);
      for (const name of HOOK_NAMES) {
        expect(v.hooks[name]).toBe("missing");
      }
    });

    it("reports all ok after install", () => {
      const dir = createGitRepo("verify-ok");
      dirs.push(dir);

      installHooks(dir);
      const v = verifyHooks(dir);

      expect(v.hooksPathSet).toBe(true);
      expect(v.hooksPathValue).toBe(".dx/hooks");
      for (const name of HOOK_NAMES) {
        expect(v.hooks[name]).toBe("ok");
      }
    });

    it("reports outdated for tampered hook", () => {
      const dir = createGitRepo("verify-outdated");
      dirs.push(dir);

      installHooks(dir);
      writeFileSync(path.join(dir, ".dx", "hooks", "pre-push"), "#!/bin/sh\necho hacked\n");

      const v = verifyHooks(dir);
      expect(v.hooks["pre-push"]).toBe("outdated");
      expect(v.hooks["commit-msg"]).toBe("ok");
    });
  });

  // ── hooksHealthy ──────────────────────────────────────

  describe("hooksHealthy", () => {
    it("returns false before install", () => {
      const dir = createGitRepo("healthy-no");
      dirs.push(dir);
      expect(hooksHealthy(dir)).toBe(false);
    });

    it("returns true after install", () => {
      const dir = createGitRepo("healthy-yes");
      dirs.push(dir);
      installHooks(dir);
      expect(hooksHealthy(dir)).toBe(true);
    });

    it("returns false after tampering", () => {
      const dir = createGitRepo("healthy-tamper");
      dirs.push(dir);
      installHooks(dir);
      writeFileSync(path.join(dir, ".dx", "hooks", "commit-msg"), "#!/bin/sh\nexit 0\n");
      expect(hooksHealthy(dir)).toBe(false);
    });
  });
});
