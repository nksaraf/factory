/**
 * Variable management handler.
 *
 * --local targets ~/.config/dx/vars.json (no Factory connection needed).
 * Without --local, targets the Factory API (requires auth).
 */

import { styleError, styleInfo, styleSuccess } from "../cli-style.js"
import {
  localVarSet,
  localVarGet,
  localVarList,
  localVarRemove,
} from "./var-local-store.js"
import { getFactoryFetchClient } from "./factory-fetch.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VarFlags {
  local?: boolean
  scope?: string
  team?: string
  project?: string
  system?: string
  site?: string
  deployment?: string
  env?: string
  json?: boolean
}

function buildScopeParams(flags: VarFlags): Record<string, string> {
  const params: Record<string, string> = {}
  if (flags.deployment) {
    params.scopeType = "deployment"
    params.scopeId = flags.deployment
  } else if (flags.site) {
    params.scopeType = "site"
    params.scopeId = flags.site
  } else if (flags.project) {
    params.scopeType = "project"
    params.scopeId = flags.project
  } else if (flags.team) {
    params.scopeType = "team"
    params.scopeId = flags.team
  } else if (flags.system) {
    params.scopeType = "system"
    params.scopeId = flags.system
  } else if (flags.scope) {
    params.scopeType = flags.scope
    params.scopeId = "default"
  } else {
    params.scopeType = "org"
    params.scopeId = "default"
  }
  if (flags.env) params.environment = flags.env
  return params
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function varSet(
  key: string,
  value: string,
  flags: VarFlags
): Promise<void> {
  if (flags.local) {
    localVarSet(key, value)
    console.log(styleSuccess(`Set local variable: ${key}`))
    return
  }

  const client = await getFactoryFetchClient()
  const res = await client.fetchApi("/vars", {
    method: "POST",
    body: JSON.stringify({
      slug: key,
      name: key,
      value,
      ...buildScopeParams(flags),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to set variable: ${res.status} ${body}`)
  }

  console.log(styleSuccess(`Set variable: ${key}`))
}

export async function varGet(key: string, flags: VarFlags): Promise<void> {
  if (flags.local) {
    const value = localVarGet(key)
    if (value === undefined) {
      console.log(styleError(`Variable not found: ${key}`))
      process.exit(1)
    }
    if (flags.json) {
      console.log(JSON.stringify({ key, value }))
    } else {
      console.log(value)
    }
    return
  }

  const client = await getFactoryFetchClient()
  const params = new URLSearchParams(buildScopeParams(flags))
  const res = await client.fetchApi(
    `/vars/${encodeURIComponent(key)}?${params}`
  )

  if (!res.ok) {
    if (res.status === 404) {
      console.log(styleError(`Variable not found: ${key}`))
      process.exit(1)
    }
    const body = await res.text()
    throw new Error(`Failed to get variable: ${res.status} ${body}`)
  }

  const data = (await res.json()) as { slug: string; value: string }
  if (flags.json) {
    console.log(JSON.stringify({ key, value: data.value }))
  } else {
    console.log(data.value)
  }
}

export async function varList(flags: VarFlags): Promise<void> {
  if (flags.local) {
    const vars = localVarList()
    if (flags.json) {
      console.log(JSON.stringify(vars))
    } else if (vars.length === 0) {
      console.log(styleInfo("No local variables found."))
    } else {
      for (const v of vars) {
        console.log(`${v.key}=${v.value}`)
      }
    }
    return
  }

  const client = await getFactoryFetchClient()
  const params = new URLSearchParams(buildScopeParams(flags))
  const res = await client.fetchApi(`/vars?${params}`)

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to list variables: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    vars: Array<{
      slug: string
      value: string
      scopeType: string
      scopeId: string
      environment: string | null
      updatedAt: string
    }>
  }

  if (flags.json) {
    console.log(JSON.stringify(data.vars))
  } else if (data.vars.length === 0) {
    console.log(styleInfo("No variables found."))
  } else {
    for (const v of data.vars) {
      const env = v.environment ? ` (${v.environment})` : ""
      console.log(`${v.slug}  ${styleInfo(v.scopeType)}${env}`)
    }
  }
}

export async function varRemove(key: string, flags: VarFlags): Promise<void> {
  if (flags.local) {
    const removed = localVarRemove(key)
    if (removed) {
      console.log(styleSuccess(`Removed local variable: ${key}`))
    } else {
      console.log(styleError(`Variable not found: ${key}`))
      process.exit(1)
    }
    return
  }

  const client = await getFactoryFetchClient()
  const params = new URLSearchParams(buildScopeParams(flags))
  const res = await client.fetchApi(
    `/vars/${encodeURIComponent(key)}?${params}`,
    { method: "DELETE" }
  )

  if (!res.ok) {
    if (res.status === 404) {
      console.log(styleError(`Variable not found: ${key}`))
      process.exit(1)
    }
    const body = await res.text()
    throw new Error(`Failed to remove variable: ${res.status} ${body}`)
  }

  console.log(styleSuccess(`Removed variable: ${key}`))
}
