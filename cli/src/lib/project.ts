import type { CatalogComponent, CatalogResource, CatalogSystem } from "@smp/factory-shared/catalog";
import {
  discoverComposeFiles,
  findComposeRoot,
} from "@smp/factory-shared/config-loader";
import { loadConventions } from "@smp/factory-shared/conventions";
import type { ConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter";

export class ProjectContext {
  readonly rootDir: string;
  readonly composeFiles: string[];
  readonly conventions: ConventionsConfig;

  /** Backstage-aligned catalog representation of this project. */
  readonly catalog: CatalogSystem;

  private constructor(
    rootDir: string,
    composeFiles: string[],
    conventions: ConventionsConfig,
    catalog: CatalogSystem,
  ) {
    this.rootDir = rootDir;
    this.composeFiles = composeFiles;
    this.conventions = conventions;
    this.catalog = catalog;
  }

  get systemName(): string {
    return this.catalog.metadata.name;
  }

  get owner(): string {
    return this.catalog.spec.owner;
  }

  get componentNames(): string[] {
    return Object.keys(this.catalog.components);
  }

  get resourceNames(): string[] {
    return Object.keys(this.catalog.resources);
  }

  getComponent(name: string): CatalogComponent | undefined {
    return this.catalog.components[name];
  }

  getResource(name: string): CatalogResource | undefined {
    return this.catalog.resources[name];
  }

  /** Collect all unique profile names from components and resources. */
  get allProfiles(): string[] {
    const profiles = new Set<string>();
    for (const comp of Object.values(this.catalog.components)) {
      for (const p of comp.spec.profiles ?? []) profiles.add(p);
    }
    for (const res of Object.values(this.catalog.resources)) {
      for (const p of res.spec.profiles ?? []) profiles.add(p);
    }
    return [...profiles].sort();
  }

  static fromCwd(cwd = process.cwd()): ProjectContext {
    const rootDir = findComposeRoot(cwd);
    if (!rootDir) {
      throw new Error(
        "No docker-compose file found (searched upward from the current directory).\n" +
        "Create a docker-compose.yaml or compose/ directory to define your project catalog."
      );
    }
    const composeFiles = discoverComposeFiles(rootDir);
    const adapter = new DockerComposeFormatAdapter();
    const { system: catalog } = adapter.parse(rootDir);
    const conventions = loadConventions(rootDir);
    return new ProjectContext(rootDir, composeFiles, conventions, catalog);
  }
}
