import { describe, expect, it } from "vitest";
import { parseHostname } from "./gateway-proxy";

describe("parseHostname", () => {
  it("parses tunnel hostname", () => {
    expect(parseHostname("happy-fox-42.tunnel.dx.dev")).toEqual({
      family: "tunnel",
      slug: "happy-fox-42",
    });
  });

  it("parses preview hostname", () => {
    expect(parseHostname("pr-42--fix-auth--myapp.preview.dx.dev")).toEqual({
      family: "preview",
      slug: "pr-42--fix-auth--myapp",
    });
  });

  it("parses sandbox hostname", () => {
    expect(parseHostname("dev-nikhil-abc.sandbox.dx.dev")).toEqual({
      family: "sandbox",
      slug: "dev-nikhil-abc",
    });
  });

  it("parses sandbox with port suffix", () => {
    expect(parseHostname("dev-nikhil-abc-8080.sandbox.dx.dev")).toEqual({
      family: "sandbox",
      slug: "dev-nikhil-abc-8080",
    });
  });

  it("returns null for non-gateway hostnames", () => {
    expect(parseHostname("api.prod.dx.dev")).toBeNull();
    expect(parseHostname("app.example.com")).toBeNull();
    expect(parseHostname("dx.dev")).toBeNull();
  });

  it("returns null for empty or missing host", () => {
    expect(parseHostname("")).toBeNull();
    expect(parseHostname(undefined as any)).toBeNull();
  });
});
