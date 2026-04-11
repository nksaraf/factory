/**
 * Secret management handler.
 *
 * --local targets ~/.config/dx/secrets.json (no Factory connection needed).
 * Without --local, targets the Factory API (requires auth).
 */

import { styleError, styleInfo, styleSuccess } from "../cli-style.js"
import {
  localSecretSet,
  localSecretGet,
  localSecretList,
  localSecretRemove,
} from "./secret-local-store.js"
import { getFactoryFetchClient } from "./factory-fetch.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretFlags {
  local?: boolean
  scope?: string
  team?: string
  project?: string
  env?: string
  json?: boolean
}

function buildScopeParams(flags: SecretFlags): Record<string, string> {
  const params: Record<string, string> = {}
  if (flags.scope) {
    params.scopeType = flags.scope
  } else if (flags.project) {
    params.scopeType = "project"
  } else if (flags.team) {
    params.scopeType = "team"
  } else {
    params.scopeType = "org"
  }
  if (flags.team) params.scopeId = flags.team
  if (flags.project) params.scopeId = flags.project
  if (!params.scopeId) params.scopeId = "default"
  if (flags.env) params.environment = flags.env
  return params
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function secretSet(
  key: string,
  value: string,
  flags: SecretFlags
): Promise<void> {
  if (flags.local) {
    localSecretSet(key, value)
    console.log(styleSuccess(`Set local secret: ${key}`))
    return
  }

  const client = await getFactoryFetchClient()
  const res = await client.fetchApi("/secrets", {
    method: "POST",
    body: JSON.stringify({
      slug: key,
      value,
      ...buildScopeParams(flags),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to set secret: ${res.status} ${body}`)
  }

  console.log(styleSuccess(`Set secret: ${key}`))
}

export async function secretGet(
  key: string,
  flags: SecretFlags
): Promise<void> {
  if (flags.local) {
    const value = localSecretGet(key)
    if (value === undefined) {
      console.log(styleError(`Secret not found: ${key}`))
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
    `/secrets/${encodeURIComponent(key)}?${params}`
  )

  if (!res.ok) {
    if (res.status === 404) {
      console.log(styleError(`Secret not found: ${key}`))
      process.exit(1)
    }
    const body = await res.text()
    throw new Error(`Failed to get secret: ${res.status} ${body}`)
  }

  const data = (await res.json()) as { value: string }
  if (flags.json) {
    console.log(JSON.stringify({ key, value: data.value }))
  } else {
    console.log(data.value)
  }
}

export async function secretList(flags: SecretFlags): Promise<void> {
  if (flags.local) {
    const secrets = localSecretList()
    if (flags.json) {
      console.log(JSON.stringify(secrets))
    } else if (secrets.length === 0) {
      console.log(styleInfo("No local secrets found."))
    } else {
      for (const s of secrets) {
        console.log(s.key)
      }
    }
    return
  }

  const client = await getFactoryFetchClient()
  const params = new URLSearchParams(buildScopeParams(flags))
  const res = await client.fetchApi(`/secrets?${params}`)

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to list secrets: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    secrets: Array<{
      slug: string
      scopeType: string
      environment: string
      updatedAt: string
    }>
  }

  if (flags.json) {
    console.log(JSON.stringify(data.secrets))
  } else if (data.secrets.length === 0) {
    console.log(styleInfo("No secrets found."))
  } else {
    for (const s of data.secrets) {
      const env = s.environment !== "all" ? ` (${s.environment})` : ""
      console.log(`${s.slug}  ${styleInfo(s.scopeType)}${env}`)
    }
  }
}

export async function secretRemove(
  key: string,
  flags: SecretFlags
): Promise<void> {
  if (flags.local) {
    const removed = localSecretRemove(key)
    if (removed) {
      console.log(styleSuccess(`Removed local secret: ${key}`))
    } else {
      console.log(styleError(`Secret not found: ${key}`))
      process.exit(1)
    }
    return
  }

  const client = await getFactoryFetchClient()
  const params = new URLSearchParams(buildScopeParams(flags))
  const res = await client.fetchApi(
    `/secrets/${encodeURIComponent(key)}?${params}`,
    { method: "DELETE" }
  )

  if (!res.ok) {
    if (res.status === 404) {
      console.log(styleError(`Secret not found: ${key}`))
      process.exit(1)
    }
    const body = await res.text()
    throw new Error(`Failed to remove secret: ${res.status} ${body}`)
  }

  console.log(styleSuccess(`Removed secret: ${key}`))
}

export async function secretRotate(
  key: string,
  flags: SecretFlags & { value?: string }
): Promise<void> {
  if (flags.value) {
    // Setting a new value is just a set operation
    return secretSet(key, flags.value, flags)
  }

  // Re-encrypt with current master key (server-side)
  const client = await getFactoryFetchClient()
  const scopeParams = buildScopeParams(flags)
  const res = await client.fetchApi("/secrets/rotate", {
    method: "POST",
    body: JSON.stringify({
      slug: key,
      scopeType: scopeParams.scopeType,
      ...(scopeParams.scopeId ? { scopeId: scopeParams.scopeId } : {}),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to rotate secret: ${res.status} ${body}`)
  }

  const data = (await res.json()) as { rotated: number }
  console.log(styleSuccess(`Rotated ${data.rotated} secret(s) for key: ${key}`))
}
