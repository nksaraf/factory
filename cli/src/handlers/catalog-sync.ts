import type { CatalogSyncResult } from "@smp/factory-shared/catalog"

import { styleBold, styleMuted, styleSuccess } from "../cli-style.js"
import { getFactoryRestClient } from "../client.js"
import { loadCatalog } from "../lib/catalog.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

export async function runCatalogSync(
  flags: DxFlags,
  opts: { dryRun?: boolean } = {}
): Promise<void> {
  const result = loadCatalog(process.cwd())

  if (!result) {
    exitWithError(
      flags,
      "No catalog source detected. Run `dx catalog doctor` to set up catalog labels."
    )
    return
  }

  const catalog = result.catalog
  if (!catalog.metadata?.name) {
    exitWithError(
      flags,
      "Catalog has no system name. Add `x-catalog.name` to your docker-compose.yaml."
    )
    return
  }

  const componentSlugs = Object.keys(catalog.components)
  const resourceSlugs = Object.keys(catalog.resources)
  const apiSlugs = Object.keys(catalog.apis ?? {})
  const allComponentSlugs = [...componentSlugs, ...resourceSlugs]

  // Dry run: report what would be synced without hitting the API
  if (opts.dryRun) {
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            data: {
              dryRun: true,
              format: result.format,
              systemSlug: catalog.metadata.name,
              owner: catalog.spec.owner,
              components: allComponentSlugs.length,
              apis: apiSlugs.length,
              componentSlugs: allComponentSlugs,
              apiSlugs,
            },
          },
          null,
          2
        )
      )
      return
    }

    console.log("")
    console.log(`  ${styleBold("Dry run")} — no changes made.`)
    console.log(
      `  Source:     ${result.format} ${styleMuted(`(${result.file})`)}`
    )
    console.log(
      `  System:     ${catalog.metadata.name} ${styleMuted(`(owner: ${catalog.spec.owner})`)}`
    )
    console.log(`  Components: ${allComponentSlugs.length} would be synced`)
    console.log(`  APIs:       ${apiSlugs.length} would be synced`)
    if (allComponentSlugs.length) {
      console.log(`              ${styleMuted(allComponentSlugs.join(", "))}`)
    }
    if (apiSlugs.length) {
      console.log(`              ${styleMuted(apiSlugs.join(", "))}`)
    }
    console.log("")
    return
  }

  // Actual sync: POST catalog to factory API
  const client = await getFactoryRestClient()

  let syncResult: { data: CatalogSyncResult }
  try {
    syncResult = await client.request<{ data: CatalogSyncResult }>(
      "POST",
      "/api/v1/factory/catalog/sync",
      catalog
    )
  } catch (err) {
    exitWithError(
      flags,
      `Failed to sync catalog: ${err instanceof Error ? err.message : String(err)}`
    )
    return
  }

  if (flags.json) {
    console.log(JSON.stringify(syncResult, null, 2))
    return
  }

  const d = syncResult.data

  console.log("")
  console.log(`  ${styleSuccess("Catalog synced to factory.")}`)
  console.log(
    `  System:     ${d.systemSlug} ${styleMuted(`(${d.systemId})`)}${d.systemCreated ? " [created]" : ""}`
  )
  console.log(
    `  Components: ${d.componentsUpserted} upserted (${d.created.components.length} created, ${d.updated.components.length} updated)`
  )
  console.log(
    `  APIs:       ${d.apisUpserted} upserted (${d.created.apis.length} created, ${d.updated.apis.length} updated)`
  )
  console.log("")
}
