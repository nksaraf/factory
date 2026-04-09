import { describe, expect, it } from "vitest";

import { getRepoDisplayName } from "./repo-picker.js";

describe("getRepoDisplayName", () => {
  it("derives owner and repo from HTTPS URLs", () => {
    expect(
      getRepoDisplayName({
        name: "factory",
        gitUrl: "https://github.com/LeptonSoftware/factory.git",
      }),
    ).toBe("LeptonSoftware/factory");
  });

  it("derives owner and repo from SSH URLs", () => {
    expect(
      getRepoDisplayName({
        name: "factory",
        gitUrl: "git@github.com:LeptonSoftware/factory.git",
      }),
    ).toBe("LeptonSoftware/factory");
  });

  it("falls back to the repo name when the URL cannot be parsed", () => {
    expect(
      getRepoDisplayName({
        name: "factory",
        gitUrl: "not-a-url",
      }),
    ).toBe("factory");
  });
});
