import type { DxBase } from "../dx-root.js"
import {
  runCustomerList,
  runCustomerShow,
  runCustomerCreate,
  runCustomerAction,
} from "../handlers/customer.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("customer", [
  "$ dx customer list             List all customers",
  "$ dx customer list --json      Output as JSON",
  "$ dx customer show verizon     Show customer details",
  "$ dx customer create --slug acme --name 'Acme Corp'",
  "$ dx customer activate acme    Activate a customer",
  "$ dx customer suspend acme     Suspend a customer",
  "$ dx customer terminate acme   Terminate a customer",
])

export function customerCommand(app: DxBase) {
  return app
    .sub("customer")
    .meta({ description: "Customers" })
    .command("list", (c) =>
      c.meta({ description: "List customers" }).run(({ flags }) => {
        return runCustomerList(toDxFlags(flags))
      })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show customer" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Customer ID",
          },
        ])
        .run(({ args, flags }) => {
          return runCustomerShow(toDxFlags(flags), args.id)
        })
    )
    .command("create", (c) =>
      c
        .flags({
          slug: {
            type: "string",
            required: true,
            description: "Customer slug",
          },
          name: {
            type: "string",
            required: true,
            description: "Customer name",
          },
          type: {
            type: "string",
            description: "Customer type (default: direct)",
          },
          "billing-email": {
            type: "string",
            description: "Billing email address",
          },
        })
        .run(({ flags }) => {
          return runCustomerCreate(toDxFlags(flags), {
            slug: flags.slug as string,
            name: flags.name as string,
            type: flags.type as string | undefined,
            billingEmail: flags["billing-email"] as string | undefined,
          })
        })
    )
    .command("activate", (c) =>
      c
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Customer slug",
          },
        ])
        .run(({ args, flags }) => {
          return runCustomerAction(toDxFlags(flags), args.slug, "activate")
        })
    )
    .command("suspend", (c) =>
      c
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Customer slug",
          },
        ])
        .run(({ args, flags }) => {
          return runCustomerAction(toDxFlags(flags), args.slug, "suspend")
        })
    )
    .command("terminate", (c) =>
      c
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Customer slug",
          },
        ])
        .run(({ args, flags }) => {
          return runCustomerAction(toDxFlags(flags), args.slug, "terminate")
        })
    )
}
