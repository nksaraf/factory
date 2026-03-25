import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  buildConfigSchema,
  devConfigSchema,
  dxComponentYamlSchema,
  dxYamlSchema,
  type DxComponentRef,
  type DxComponentYaml,
  type DxYaml,
} from "./config-schemas";

/** Shown when dx.yaml is missing required structure; keep in sync with CLI `init` command. */
export const DX_INIT_COMMAND = "dx init";

/** Walk up from startDir to find dx.yaml. Returns path or null. */
export function findDxYaml(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "dx.yaml");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const p = i.path.length ? i.path.join(".") : "(root)";
      return `  - ${p}: ${i.message}`;
    })
    .join("\n");
}

/** Parse and validate dx.yaml from a file path. */
export function loadModuleConfig(filePath: string): DxYaml {
  const raw = readFileSync(filePath, "utf8");
  const data = parseYaml(raw) as unknown;

  if (data == null) {
    throw new Error(
      `dx.yaml is empty or parses to null (${filePath}).\n` +
        `Run \`${DX_INIT_COMMAND}\` in that directory to create a starter file, then edit module, team, and components.`
    );
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `dx.yaml must be a YAML mapping (object), not an array or scalar (${filePath}).\n` +
        `Run \`${DX_INIT_COMMAND}\` for a valid template.`
    );
  }

  const parsed = dxYamlSchema.safeParse(data);
  if (!parsed.success) {
    const keys = Object.keys(data as Record<string, unknown>);
    const emptyMapping = keys.length === 0;
    const hint = emptyMapping
      ? `The file is an empty mapping {}. Run \`${DX_INIT_COMMAND}\` or set module, team, and components.`
      : `Fix the fields below, or run \`${DX_INIT_COMMAND}\` to regenerate a starter file.`;
    throw new Error(
      `Invalid dx.yaml (${filePath}). ${hint}\n${formatZodIssues(parsed.error)}`
    );
  }
  return parsed.data;
}

/** Load dx-component.yaml from a component directory. */
export function loadComponentConfig(componentDir: string): DxComponentYaml {
  const path = join(componentDir, "dx-component.yaml");
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const data = parseYaml(raw) as unknown;
  if (data == null || typeof data !== "object") return {};
  return dxComponentYamlSchema.parse(data);
}

/** Pull optional dx-component.yaml-shaped fields from a dx.yaml component entry. */
export function extractInlineComponentBody(
  ref: DxComponentRef
): Partial<DxComponentYaml> {
  const inline: Partial<DxComponentYaml> = {};
  if (ref.image !== undefined) inline.image = ref.image;
  if (ref.test !== undefined) inline.test = ref.test;
  if (ref.lint !== undefined) inline.lint = ref.lint;
  if (ref.build !== undefined) inline.build = ref.build;
  if (ref.dev !== undefined) inline.dev = ref.dev;
  return inline;
}

/**
 * Merge per-component file config with inline dx.yaml fields. Inline wins for
 * each provided key; `dev` merges command/sync shallowly.
 */
export function mergeComponentYaml(
  file: DxComponentYaml,
  inline: Partial<DxComponentYaml>
): DxComponentYaml {
  const hasInline =
    inline.image !== undefined ||
    inline.build !== undefined ||
    inline.dev !== undefined ||
    inline.test !== undefined ||
    inline.lint !== undefined;
  if (!hasInline) return file;

  const merged: Record<string, unknown> = { ...file };

  if (inline.image !== undefined) merged.image = inline.image;
  if (inline.test !== undefined) merged.test = inline.test;
  if (inline.lint !== undefined) merged.lint = inline.lint;

  if (inline.build !== undefined) {
    merged.build = buildConfigSchema.parse({
      ...(file.build ?? {}),
      ...inline.build,
    });
  }

  if (inline.dev !== undefined) {
    merged.dev = devConfigSchema.parse({
      command:
        inline.dev.command !== undefined
          ? inline.dev.command
          : file.dev?.command,
      sync:
        inline.dev.sync !== undefined
          ? inline.dev.sync
          : (file.dev?.sync ?? []),
    });
  }

  return dxComponentYamlSchema.parse(merged);
}

/** Load module config + all component configs. */
export function loadFullConfig(rootDir: string): {
  module: DxYaml;
  components: Record<string, DxComponentYaml>;
} {
  const modulePath = join(rootDir, "dx.yaml");
  const module = loadModuleConfig(modulePath);
  const components: Record<string, DxComponentYaml> = {};
  for (const [name, ref] of Object.entries(module.components)) {
    const dir = join(rootDir, ref.path);
    const fileCfg = loadComponentConfig(dir);
    const inline = extractInlineComponentBody(ref);
    components[name] = mergeComponentYaml(fileCfg, inline);
  }
  return { module, components };
}
