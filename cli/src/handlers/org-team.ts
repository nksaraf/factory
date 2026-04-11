import { getFactoryClient, getFactoryRestClient } from "../client.js"
import {
  actionResult,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
} from "../commands/list-helpers.js"
import { writeStdoutJsonDocument } from "../lib/cli-output.js"
import type { DxFlags } from "../stub.js"
import { fetchAllOrgPrincipals } from "./org-identity.js"

const ORG_PAGE_SIZE = 200

type TeamRow = {
  id: string
  slug: string
  name: string
  type: string
  parentTeamId: string | null
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type MembershipRow = {
  id: string
  principalId: string
  teamId: string
  spec: { role?: string }
  createdAt: string
}

function specStr(spec: Record<string, unknown>, key: string): string {
  const v = spec?.[key]
  return typeof v === "string" ? v : ""
}

async function fetchAllTeams(
  rest: Awaited<ReturnType<typeof getFactoryRestClient>>
): Promise<TeamRow[]> {
  const all: TeamRow[] = []
  let offset = 0
  for (;;) {
    const res = await rest.request<{ data: TeamRow[] }>(
      "GET",
      `/api/v1/factory/org/teams?limit=${ORG_PAGE_SIZE}&offset=${offset}`
    )
    const chunk = Array.isArray(res.data) ? res.data : []
    all.push(...chunk)
    if (chunk.length < ORG_PAGE_SIZE) break
    offset += ORG_PAGE_SIZE
  }
  return all
}

async function resolveTeamId(
  flags: DxFlags,
  rest: Awaited<ReturnType<typeof getFactoryRestClient>>,
  slugOrId: string
): Promise<string> {
  const res = await rest.request<{ data: TeamRow }>(
    "GET",
    `/api/v1/factory/org/teams/${encodeURIComponent(slugOrId)}`
  )
  const row = res.data
  if (!row?.id) {
    throw new Error(`Team not found: ${slugOrId}`)
  }
  return row.id
}

async function fetchTeamMembers(
  rest: Awaited<ReturnType<typeof getFactoryRestClient>>,
  teamSlugOrId: string
): Promise<MembershipRow[]> {
  const all: MembershipRow[] = []
  let offset = 0
  for (;;) {
    const res = await rest.request<{ data: MembershipRow[] }>(
      "GET",
      `/api/v1/factory/org/teams/${encodeURIComponent(teamSlugOrId)}/members?limit=${ORG_PAGE_SIZE}&offset=${offset}`
    )
    const chunk = Array.isArray(res.data) ? res.data : []
    all.push(...chunk)
    if (chunk.length < ORG_PAGE_SIZE) break
    offset += ORG_PAGE_SIZE
  }
  return all
}

export async function runTeamList(flags: DxFlags): Promise<void> {
  const rest = await getFactoryRestClient()
  const teams = await fetchAllTeams(rest)
  const idToSlug = new Map(teams.map((t) => [t.id, t.slug]))
  const body = { data: teams }
  tableOrJson(
    flags,
    body,
    ["slug", "name", "type", "parent", "description"],
    (t: TeamRow) => [
      t.slug,
      t.name,
      t.type,
      t.parentTeamId
        ? (idToSlug.get(t.parentTeamId) ?? t.parentTeamId)
        : styleMuted("-"),
      specStr(t.spec, "description") || styleMuted("-"),
    ],
    undefined,
    { emptyMessage: "No teams found." }
  )
}

export async function runTeamShow(
  flags: DxFlags,
  slugOrId: string,
  opts?: { withMembers?: boolean }
): Promise<void> {
  const rest = await getFactoryRestClient()
  const res = await rest.request<{ data: TeamRow }>(
    "GET",
    `/api/v1/factory/org/teams/${encodeURIComponent(slugOrId)}`
  )
  const team = res.data
  if (!team) {
    console.log("Team not found.")
    return
  }

  let parentLabel = styleMuted("-")
  if (team.parentTeamId) {
    try {
      const pr = await rest.request<{ data: TeamRow }>(
        "GET",
        `/api/v1/factory/org/teams/${encodeURIComponent(team.parentTeamId)}`
      )
      parentLabel = pr.data?.slug ?? team.parentTeamId
    } catch {
      parentLabel = team.parentTeamId
    }
  }

  let members: Array<
    MembershipRow & { principalSlug: string; principalName: string }
  > = []
  if (opts?.withMembers) {
    const api = await getFactoryClient()
    const raw = await fetchTeamMembers(rest, slugOrId)
    const principals = await fetchAllOrgPrincipals(flags, api)
    const pmap = new Map(principals.map((p) => [p.id, p]))
    members = raw.map((m) => {
      const p = pmap.get(m.principalId)
      return {
        ...m,
        principalSlug: p?.slug ?? m.principalId,
        principalName: p?.name ?? styleMuted("unknown"),
      }
    })
  }

  if (flags.json) {
    writeStdoutJsonDocument({
      success: true,
      data: opts?.withMembers ? { ...team, members } : team,
    })
    return
  }

  console.log(styleBold(team.name))
  console.log(`${styleMuted("ID")}            ${team.id}`)
  console.log(`${styleMuted("Slug")}          ${team.slug}`)
  console.log(`${styleMuted("Type")}          ${team.type}`)
  console.log(`${styleMuted("Parent team")}  ${parentLabel}`)
  const desc = specStr(team.spec, "description")
  if (desc) console.log(`${styleMuted("Description")}  ${desc}`)

  if (opts?.withMembers) {
    console.log()
    if (members.length === 0) {
      console.log(styleMuted("No members."))
    } else {
      console.log(styleBold("Members"))
      const { printTable } = await import("../output.js")
      console.log(
        printTable(
          ["principal", "name", "role"],
          members.map((m) => [
            m.principalSlug,
            m.principalName,
            m.spec?.role ?? "member",
          ])
        )
      )
    }
  }
}

export async function runTeamCreate(
  flags: DxFlags,
  slug: string,
  name: string,
  opts: {
    type?: string
    parent?: string
    description?: string
    slackChannel?: string
    oncallUrl?: string
  }
): Promise<void> {
  const rest = await getFactoryRestClient()
  let parentTeamId: string | undefined
  if (opts.parent) {
    parentTeamId = await resolveTeamId(flags, rest, opts.parent)
  }
  const spec: Record<string, string> = {}
  if (opts.description) spec.description = opts.description
  if (opts.slackChannel) spec.slackChannel = opts.slackChannel
  if (opts.oncallUrl) spec.oncallUrl = opts.oncallUrl

  const body: Record<string, unknown> = { slug, name, spec }
  if (opts.type) body.type = opts.type
  if (parentTeamId) body.parentTeamId = parentTeamId

  const data = await rest.request<{ data: TeamRow }>(
    "POST",
    "/api/v1/factory/org/teams",
    body
  )
  const created = data.data
  actionResult(
    flags,
    data,
    styleSuccess(`Created team ${slug}${created?.id ? ` (${created.id})` : ""}`)
  )
}

export async function runTeamUpdate(
  flags: DxFlags,
  slugOrId: string,
  opts: {
    name?: string
    type?: string
    parent?: string | null
    description?: string
    slackChannel?: string
    oncallUrl?: string
  }
): Promise<void> {
  const rest = await getFactoryRestClient()
  const current = await rest.request<{ data: TeamRow }>(
    "GET",
    `/api/v1/factory/org/teams/${encodeURIComponent(slugOrId)}`
  )
  const team = current.data
  if (!team) {
    throw new Error(`Team not found: ${slugOrId}`)
  }

  const body: Record<string, unknown> = {}
  if (opts.name !== undefined) body.name = opts.name
  if (opts.type !== undefined) body.type = opts.type

  if (opts.parent !== undefined) {
    if (opts.parent === null || opts.parent === "") {
      body.parentTeamId = null
    } else {
      body.parentTeamId = await resolveTeamId(flags, rest, opts.parent)
    }
  }

  const spec: Record<string, unknown> = {
    ...(typeof team.spec === "object" && team.spec ? team.spec : {}),
  }
  let specTouched = false
  if (opts.description !== undefined) {
    spec.description = opts.description
    specTouched = true
  }
  if (opts.slackChannel !== undefined) {
    spec.slackChannel = opts.slackChannel
    specTouched = true
  }
  if (opts.oncallUrl !== undefined) {
    spec.oncallUrl = opts.oncallUrl
    specTouched = true
  }
  if (specTouched) body.spec = spec

  if (Object.keys(body).length === 0) {
    throw new Error("No changes specified. Pass flags to update fields.")
  }

  const data = await rest.request<{ data: TeamRow }>(
    "POST",
    `/api/v1/factory/org/teams/${encodeURIComponent(slugOrId)}/update`,
    body
  )
  actionResult(flags, data, styleSuccess(`Updated team ${slugOrId}`))
}

export async function runTeamDelete(
  flags: DxFlags,
  slugOrId: string
): Promise<void> {
  const rest = await getFactoryRestClient()
  const data = await rest.request<{ data: { deleted: boolean } }>(
    "POST",
    `/api/v1/factory/org/teams/${encodeURIComponent(slugOrId)}/delete`
  )
  actionResult(flags, data, styleSuccess(`Deleted team ${slugOrId}`))
}

export async function runTeamMemberList(
  flags: DxFlags,
  teamSlugOrId: string
): Promise<void> {
  const rest = await getFactoryRestClient()
  const api = await getFactoryClient()
  const raw = await fetchTeamMembers(rest, teamSlugOrId)
  const principals = await fetchAllOrgPrincipals(flags, api)
  const pmap = new Map(principals.map((p) => [p.id, p]))

  const rows = raw.map((m) => {
    const p = pmap.get(m.principalId)
    return {
      principal: p?.slug ?? m.principalId,
      name: p?.name ?? "",
      role: m.spec?.role ?? "member",
      membershipId: m.id,
    }
  })

  tableOrJson(
    flags,
    { data: rows },
    ["principal", "name", "role"],
    (r: (typeof rows)[0]) => [r.principal, r.name, r.role],
    undefined,
    { emptyMessage: "No members on this team." }
  )
}

const MEMBER_ROLES = new Set(["member", "lead", "admin"])

export async function runTeamMemberAdd(
  flags: DxFlags,
  teamSlugOrId: string,
  principalSlugOrId: string,
  role?: string
): Promise<void> {
  if (role && !MEMBER_ROLES.has(role)) {
    throw new Error(`Invalid role '${role}' (use member, lead, or admin)`)
  }
  const rest = await getFactoryRestClient()
  const body: { principal: string; role?: string } = {
    principal: principalSlugOrId,
  }
  if (role) body.role = role
  const data = await rest.request<{ data: unknown }>(
    "POST",
    `/api/v1/factory/org/teams/${encodeURIComponent(teamSlugOrId)}/add-member`,
    body
  )
  actionResult(
    flags,
    data,
    styleSuccess(`Added ${principalSlugOrId} to team ${teamSlugOrId}`)
  )
}

export async function runTeamMemberRemove(
  flags: DxFlags,
  teamSlugOrId: string,
  principalSlugOrId: string
): Promise<void> {
  const rest = await getFactoryRestClient()
  const data = await rest.request<{ data: unknown }>(
    "POST",
    `/api/v1/factory/org/teams/${encodeURIComponent(teamSlugOrId)}/remove-member`,
    { principal: principalSlugOrId }
  )
  actionResult(
    flags,
    data,
    styleSuccess(`Removed ${principalSlugOrId} from team ${teamSlugOrId}`)
  )
}
