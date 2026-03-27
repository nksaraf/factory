/**
 * Format adapter registry for the Software Catalog.
 *
 * Each adapter can detect, parse, and generate a specific config format
 * (docker-compose, backstage catalog, helm chart).
 */

import type { CatalogSystem } from "./catalog";

export type CatalogFormat = "docker-compose" | "backstage" | "helm";

export interface CatalogParseResult {
  system: CatalogSystem;
  /** Warnings about information that could not be represented */
  warnings: string[];
  /** Detected source format version */
  sourceVersion?: string;
}

export interface CatalogGenerateResult {
  /** Output files: path → content */
  files: Record<string, string>;
  /** Warnings about information lost in translation */
  warnings: string[];
}

export interface CatalogFormatAdapter {
  readonly format: CatalogFormat;

  /** Can this adapter handle the given directory? */
  detect(rootDir: string): Promise<boolean> | boolean;

  /** Parse source files into a CatalogSystem */
  parse(rootDir: string): Promise<CatalogParseResult> | CatalogParseResult;

  /** Generate output files from a CatalogSystem */
  generate(
    system: CatalogSystem,
    options?: { rootDir?: string }
  ): CatalogGenerateResult;
}

// ─── Registry ────────────────────────────────────────────────

const adapters = new Map<CatalogFormat, () => CatalogFormatAdapter>();

export function registerCatalogFormat(
  format: CatalogFormat,
  factory: () => CatalogFormatAdapter
): void {
  adapters.set(format, factory);
}

export function getCatalogFormat(format: CatalogFormat): CatalogFormatAdapter {
  const factory = adapters.get(format);
  if (!factory) {
    throw new Error(
      `No catalog format adapter for: ${format}. Registered: ${[...adapters.keys()].join(", ")}`
    );
  }
  return factory();
}

/** Auto-detect which format is present. Returns first match in priority order. */
export async function detectCatalogFormat(
  rootDir: string,
  preferenceOrder: CatalogFormat[] = ["docker-compose", "backstage"]
): Promise<CatalogFormat | null> {
  for (const format of preferenceOrder) {
    const factory = adapters.get(format);
    if (factory) {
      const adapter = factory();
      if (await adapter.detect(rootDir)) return format;
    }
  }
  return null;
}
