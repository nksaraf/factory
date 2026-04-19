import { describe, test } from "bun:test"
import { getTableColumns, getTableName } from "drizzle-orm"
import { estate, host, realm } from "../db/schema/infra"
import { system, component } from "../db/schema/software"
import { team, principal } from "../db/schema/org"
import { site, systemDeployment, workbench } from "../db/schema/ops"

describe("schema introspection", () => {
  const tables = {
    estate,
    host,
    realm,
    system,
    component,
    team,
    principal,
    site,
    systemDeployment,
    workbench,
  }

  for (const [name, table] of Object.entries(tables)) {
    test(`${name} columns`, () => {
      const cols = getTableColumns(table)
      const tableName = getTableName(table)
      console.log(`\n${name} (${tableName}):`)
      for (const [key, col] of Object.entries(cols)) {
        console.log(
          `  ${key}: columnType=${col.columnType} notNull=${col.notNull} hasDefault=${col.hasDefault} name=${col.name}`
        )
      }
    })
  }
})
