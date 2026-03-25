import type { DxBase } from "../dx-root.js"
import { runCustomerList, runCustomerShow } from "../handlers/customer.js"
import { toDxFlags } from "./dx-flags.js"

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
}
