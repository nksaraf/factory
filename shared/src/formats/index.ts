/**
 * Auto-register all built-in format adapters.
 * Import this module to make docker-compose, backstage, and helm adapters available.
 */

import { registerCatalogFormat } from "../catalog-registry"
import { DockerComposeFormatAdapter } from "./docker-compose.adapter"
import { BackstageFormatAdapter } from "./backstage.adapter"
import { HelmFormatAdapter } from "./helm.adapter"

export { DockerComposeFormatAdapter } from "./docker-compose.adapter"
export { BackstageFormatAdapter } from "./backstage.adapter"
export { HelmFormatAdapter } from "./helm.adapter"

registerCatalogFormat("docker-compose", () => new DockerComposeFormatAdapter())
registerCatalogFormat("backstage", () => new BackstageFormatAdapter())
registerCatalogFormat("helm", () => new HelmFormatAdapter())
