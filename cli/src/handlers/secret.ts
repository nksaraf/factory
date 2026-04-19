/**
 * Secret management handler.
 *
 * --local targets ~/.config/dx/secrets.json (no Factory connection needed).
 * Without --local, targets the Factory API via Effect programs.
 */

import { Effect } from "effect"
import { styleError, styleInfo, styleSuccess } from "../cli-style.js"
import {
  localSecretSet,
  localSecretGet,
  localSecretList,
  localSecretRemove,
} from "./secret-local-store.js"
import { runEffect } from "../effect/bridge.js"
import { makeFactoryApiLayer } from "../effect/layers/factory-api.js"
import {
  listSecrets,
  getSecret,
  setSecret,
  removeSecret,
  rotateSecret,
} from "../effect/programs/secrets.js"

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

/** Build an Effect FactoryApi layer from the existing REST client. */
async function buildLayer() {
  const { getFactoryRestClient } = await import("../client.js")
  const client = await getFactoryRestClient()
  return makeFactoryApiLayer(client)
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

  const layer = await buildLayer()
  const scopeParams = buildScopeParams(flags)
  await runEffect(
    Effect.provide(
      setSecret({
        slug: key,
        value,
        ...scopeParams,
      }),
      layer
    ),
    "setting secret"
  )

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

  const layer = await buildLayer()
  const data = await runEffect(
    Effect.provide(getSecret(key, buildScopeParams(flags)), layer),
    "getting secret"
  )

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

  const layer = await buildLayer()
  const data = await runEffect(
    Effect.provide(listSecrets(buildScopeParams(flags)), layer),
    "listing secrets"
  )

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

  const layer = await buildLayer()
  await runEffect(
    Effect.provide(removeSecret(key, buildScopeParams(flags)), layer),
    "removing secret"
  )

  console.log(styleSuccess(`Removed secret: ${key}`))
}

export async function secretRotate(
  key: string,
  flags: SecretFlags & { value?: string }
): Promise<void> {
  if (flags.value) {
    return secretSet(key, flags.value, flags)
  }

  const layer = await buildLayer()
  const scopeParams = buildScopeParams(flags)
  const data = await runEffect(
    Effect.provide(
      rotateSecret({
        slug: key,
        scopeType: scopeParams.scopeType,
        ...(scopeParams.scopeId ? { scopeId: scopeParams.scopeId } : {}),
      }),
      layer
    ),
    "rotating secret"
  )

  console.log(styleSuccess(`Rotated ${data.rotated} secret(s) for key: ${key}`))
}
