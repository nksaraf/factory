import type { DxBase } from "../dx-root.js"
import { runBundleGenerate } from "../handlers/bundle.js"
import {
  runEntitlementGrant,
  runEntitlementList,
  runEntitlementRevoke,
} from "../handlers/entitlement.js"
import { toDxFlags } from "./dx-flags.js"

export function entitlementCommand(app: DxBase) {
  return app
    .sub("entitlement")
    .meta({ description: "Entitlements" })
    .command("list", (c) =>
      c
        .meta({ description: "List entitlements" })
        .flags({
          "customer-id": {
            type: "string",
            description: "Filter by customer ID",
          },
        })
        .run(({ flags }) => {
          return runEntitlementList(toDxFlags(flags), {
            customerId: flags["customer-id"] as string | undefined,
          })
        })
    )
    .command("grant", (c) =>
      c
        .meta({ description: "Grant entitlement" })
        .flags({
          "customer-id": {
            type: "string",
            description: "Customer ID",
            required: true,
          },
          "module-id": {
            type: "string",
            description: "Module ID",
            required: true,
          },
        })
        .run(({ flags }) => {
          return runEntitlementGrant(toDxFlags(flags), {
            customerId: flags["customer-id"] as string,
            moduleId: flags["module-id"] as string,
          })
        })
    )
    .command("revoke", (c) =>
      c
        .meta({ description: "Revoke entitlement" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Entitlement ID",
          },
        ])
        .run(({ args, flags }) => {
          return runEntitlementRevoke(toDxFlags(flags), args.id)
        })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show entitlement" })
        .flags({
          "customer-id": {
            type: "string",
            description: "Filter by customer ID",
          },
        })
        .run(({ flags }) => {
          return runEntitlementList(toDxFlags(flags), {
            customerId: flags["customer-id"] as string | undefined,
          })
        })
    )
    .command("bundle", (c) =>
      c
        .meta({ description: "Generate signed entitlement bundle for air-gapped site" })
        .flags({
          "customer-id": { type: "string", description: "Customer ID", required: true },
          "site-id": { type: "string", description: "Site ID", required: true },
          "expires-at": { type: "string", description: "Expiry date (ISO)", required: true },
          "grace-days": { type: "number", description: "Grace period days (default 30)" },
        })
        .run(({ flags }) => {
          return runBundleGenerate(toDxFlags(flags), {
            customerId: flags["customer-id"] as string,
            siteId: flags["site-id"] as string,
            expiresAt: flags["expires-at"] as string,
            gracePeriodDays: flags["grace-days"] as number | undefined,
          })
        })
    )
}
