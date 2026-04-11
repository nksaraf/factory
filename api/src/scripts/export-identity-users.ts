/**
 * Export identity users from a provider to a JSON file.
 *
 * Usage:
 *   bun run api/src/scripts/export-identity-users.ts <provider> [output-path]
 *
 * Providers: github, slack, jira
 *
 * Env vars (provide the token for the provider you're exporting):
 *   GITHUB_TOKEN   — GitHub PAT or app token
 *   SLACK_BOT_TOKEN — Slack bot token (xoxb-...)
 *   JIRA_TOKEN     — Jira API token
 *   JIRA_API_URL   — Jira Cloud URL (e.g. https://team.atlassian.net)
 *   JIRA_EMAIL     — Jira admin email (for basic auth)
 */
import { getIdentityProviderAdapter } from "../adapters/adapter-registry"
import type {
  IdentityProviderConfig,
  IdentityProviderType,
} from "../adapters/identity-provider-adapter"

const VALID_PROVIDERS = ["github", "slack", "jira", "google"] as const

const provider = process.argv[2] as IdentityProviderType
if (!provider || !VALID_PROVIDERS.includes(provider as any)) {
  console.error(
    `Usage: bun run export-identity-users.ts <${VALID_PROVIDERS.join("|")}> [output-path]`
  )
  process.exit(1)
}

const outputPath = process.argv[3] ?? `./${provider}-users.json`

function buildConfig(provider: IdentityProviderType): IdentityProviderConfig {
  switch (provider) {
    case "github":
      return {
        token: requireEnv("GITHUB_TOKEN"),
        org: process.env.GITHUB_ORG,
      }
    case "slack":
      return {
        token: requireEnv("SLACK_BOT_TOKEN"),
      }
    case "jira":
      return {
        token: requireEnv("JIRA_TOKEN"),
        apiBaseUrl: process.env.JIRA_API_URL,
        extra: { email: process.env.JIRA_EMAIL },
      }
    case "google":
      return {
        token: requireEnv("GOOGLE_TOKEN"),
      }
  }
}

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return val
}

const config = buildConfig(provider)
const adapter = getIdentityProviderAdapter(provider)

console.log(`Fetching ${provider} users...`)
const users = await adapter.fetchUsers(config)

await Bun.write(outputPath, JSON.stringify(users, null, 2))
console.log(`Exported ${users.length} ${provider} users to ${outputPath}`)
