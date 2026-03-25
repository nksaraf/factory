import { dirname } from "node:path";

import {
  findDxYaml,
  loadFullConfig,
} from "@smp/factory-shared/config-loader";
import type {
  DxComponentYaml,
  DxYaml,
} from "@smp/factory-shared/config-schemas";
import { loadConventions } from "@smp/factory-shared/conventions";
import type { ConventionsConfig } from "@smp/factory-shared/conventions-schema";

export class ProjectContext {
  readonly rootDir: string;
  readonly dxYamlPath: string;
  readonly moduleConfig: DxYaml;
  readonly componentConfigs: Record<string, DxComponentYaml>;
  readonly conventions: ConventionsConfig;

  private constructor(
    rootDir: string,
    dxYamlPath: string,
    moduleConfig: DxYaml,
    componentConfigs: Record<string, DxComponentYaml>,
    conventions: ConventionsConfig
  ) {
    this.rootDir = rootDir;
    this.dxYamlPath = dxYamlPath;
    this.moduleConfig = moduleConfig;
    this.componentConfigs = componentConfigs;
    this.conventions = conventions;
  }

  static fromCwd(cwd = process.cwd()): ProjectContext {
    const dxYamlPath = findDxYaml(cwd);
    if (!dxYamlPath) {
      throw new Error("No dx.yaml found (searched upward from the current directory).");
    }
    const rootDir = dirname(dxYamlPath);
    const { module, components } = loadFullConfig(rootDir);
    const conventions = loadConventions(rootDir);
    return new ProjectContext(
      rootDir,
      dxYamlPath,
      module,
      components,
      conventions
    );
  }
}
