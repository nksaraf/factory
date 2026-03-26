/**
 * Auto-register all built-in format adapters.
 * Import this module to make dx-yaml and docker-compose adapters available.
 */

import { registerCatalogFormat } from "../catalog-registry";
import { DxYamlFormatAdapter } from "./dx-yaml.adapter";
import { DockerComposeFormatAdapter } from "./docker-compose.adapter";
import { BackstageFormatAdapter } from "./backstage.adapter";
import { HelmFormatAdapter } from "./helm.adapter";

export { DxYamlFormatAdapter } from "./dx-yaml.adapter";
export { DockerComposeFormatAdapter } from "./docker-compose.adapter";
export { BackstageFormatAdapter } from "./backstage.adapter";
export { HelmFormatAdapter } from "./helm.adapter";
export { dxYamlToCatalogSystem } from "./dx-yaml.adapter";

registerCatalogFormat("dx-yaml", () => new DxYamlFormatAdapter());
registerCatalogFormat("docker-compose", () => new DockerComposeFormatAdapter());
registerCatalogFormat("backstage", () => new BackstageFormatAdapter());
registerCatalogFormat("helm", () => new HelmFormatAdapter());
