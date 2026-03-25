import { describe, expect, it } from "vitest";

import { dxYamlSchema, dxComponentYamlSchema } from "./config-schemas";

describe("dxYamlSchema", () => {
  it("parses a minimal valid module config", () => {
    const v = dxYamlSchema.parse({
      module: "billing",
      team: "platform-eng",
      components: {
        api: { path: "./services/api", port: 8080 },
      },
    });
    expect(v.module).toBe("billing");
    expect(v.dependencies).toEqual({});
    expect(v.connections).toEqual({});
  });

  it("allows dx-component.yaml fields inline on a component", () => {
    const v = dxYamlSchema.parse({
      module: "billing",
      team: "platform-eng",
      components: {
        api: {
          path: "./api",
          port: 8080,
          image: "nginx:alpine",
          dev: { command: "nginx -g daemon off;", sync: ["./:/app"] },
          test: "pytest",
        },
      },
    });
    expect(v.components.api?.image).toBe("nginx:alpine");
    expect(v.components.api?.test).toBe("pytest");
    expect(v.components.api?.dev?.sync).toEqual(["./:/app"]);
  });

  it("rejects missing components", () => {
    expect(() =>
      dxYamlSchema.parse({
        module: "x",
        team: "t",
      })
    ).toThrow();
  });
});

describe("dxComponentYamlSchema", () => {
  it("accepts empty object", () => {
    expect(dxComponentYamlSchema.parse({})).toEqual({});
  });

  it("parses build/dev/test", () => {
    const v = dxComponentYamlSchema.parse({
      build: { dockerfile: "Dockerfile.dev", context: "." },
      dev: { command: "uvicorn main:app --reload", sync: ["./:/app"] },
      test: "pytest",
      lint: "ruff check .",
    });
    expect(v.test).toBe("pytest");
    expect(v.build?.dockerfile).toBe("Dockerfile.dev");
  });
});
