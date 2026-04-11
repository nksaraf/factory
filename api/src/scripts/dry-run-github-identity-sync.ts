/**
 * Dry-run GitHub identity discovery (no database writes).
 * Mirrors GitHubIdentityProviderAdapter: org members → fetchUserProfile per login.
 *
 * Usage:
 *   export GITHUB_TOKEN=$(gh auth token)
 *   export GITHUB_ORG=LeptonSoftware   # optional if token has a default org
 *   bun run api/src/scripts/dry-run-github-identity-sync.ts
 *
 * Optional:
 *   CHECK_LOGIN=ritvik-lepton   — always print a detailed profile attempt for this login
 */
import { Octokit } from "@octokit/rest"
import { GitHubIdentityProviderAdapter } from "../adapters/identity-provider-adapter-github"
import type { IdentityProviderConfig } from "../adapters/identity-provider-adapter"

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) {
    console.error(`Missing env: ${name}`)
    process.exit(1)
  }
  return v
}

async function profileError(
  kit: Octokit,
  login: string
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  try {
    await kit.rest.users.getByUsername({ username: login })
    return { ok: true }
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number }
    return {
      ok: false,
      message: err.message ?? String(e),
      status: err.status,
    }
  }
}

const token = requireEnv("GITHUB_TOKEN")
const orgEnv = process.env.GITHUB_ORG?.trim()
const checkLogin = process.env.CHECK_LOGIN?.trim() ?? "ritvik-lepton"

const config: IdentityProviderConfig = {
  token,
  ...(orgEnv ? { org: orgEnv } : {}),
}

const kit = new Octokit({ auth: token })

let org = orgEnv
if (!org) {
  const { data: orgs } = await kit.rest.orgs.listForAuthenticatedUser()
  if (orgs.length === 0) {
    console.error("No orgs for authenticated user; set GITHUB_ORG.")
    process.exit(1)
  }
  org = orgs[0]!.login
  console.warn(
    `\nWARNING: GITHUB_ORG not set — using first org from listForAuthenticatedUser(): "${org}".\n` +
      `If this is wrong, sync will miss members who only belong to other orgs.\n` +
      `Your orgs (first 15): ${orgs
        .slice(0, 15)
        .map((o) => o.login)
        .join(", ")}${orgs.length > 15 ? ", …" : ""}\n`
  )
}

console.log(`\n=== GitHub identity dry run ===`)
console.log(`Org: ${org}`)
console.log(`Token user (whoami):`, (await kit.rest.users.getAuthenticated()).data.login)

const members = await kit.paginate(kit.rest.orgs.listMembers, {
  org,
  per_page: 100,
})

const memberLogins = members.map((m) => m.login as string)
console.log(`\norg.listMembers: ${memberLogins.length} logins`)

if (checkLogin) {
  const inOrg = memberLogins.includes(checkLogin)
  console.log(`\n--- Spot-check: ${checkLogin} ---`)
  console.log(`  In org member list: ${inOrg}`)
  const diag = await profileError(kit, checkLogin)
  console.log(`  GET /users/${checkLogin}:`, diag.ok ? "ok" : `${diag.status ?? "?"} ${diag.message}`)
}

const adapter = new GitHubIdentityProviderAdapter()
console.log(`\n--- Adapter.fetchUsers (same as identity sync) ---`)
const users = await adapter.fetchUsers(config)
const byLogin = new Set(users.map((u) => u.login))

const dropped = memberLogins.filter((l) => !byLogin.has(l))
console.log(`fetchUsers returned: ${users.length} users`)
console.log(`Dropped (member but no profile row): ${dropped.length}`)

if (dropped.length > 0) {
  console.log(`\n--- Dropped logins + raw API error ---`)
  const concurrency = 5
  for (let i = 0; i < dropped.length; i += concurrency) {
    const batch = dropped.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (login) => {
        const r = await profileError(kit, login)
        console.log(
          `  ${login}: ${r.ok ? "(unexpected ok)" : `${r.status ?? "?"} ${r.message}`}`
        )
      })
    )
  }
}

const ritvik = users.find(
  (u) => u.login === "ritvik-lepton" || u.externalUserId === "200568187"
)
console.log(`\n--- Ritvik ---`)
console.log(
  ritvik
    ? JSON.stringify(
        {
          externalUserId: ritvik.externalUserId,
          login: ritvik.login,
          email: ritvik.email,
        },
        null,
        2
      )
    : "  Not in fetchUsers() output (see dropped list above)."
)

console.log(`\nDone (no DB changes).\n`)
