/**
 * Provision better-auth accounts for all principals with emails.
 *
 * For each principal that has an email in spec but no authUserId (or a pending: authUserId),
 * signs them up via the better-auth sign-up endpoint and updates the principal's spec.authUserId.
 *
 * Usage:
 *   FACTORY_DATABASE_URL=postgres://... bun run api/src/scripts/provision-auth-users.ts
 *
 * Env vars:
 *   FACTORY_DATABASE_URL — Database connection string
 *   AUTH_BASE_URL        — Better-auth base URL (default: http://localhost:8180/api/v1/auth)
 *   DEFAULT_PASSWORD     — Default password for all users (default: changeme123)
 */
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import { principal } from "../db/schema/org"

const DB_URL = process.env.FACTORY_DATABASE_URL ?? process.env.DATABASE_URL
if (!DB_URL) {
  console.error("FACTORY_DATABASE_URL is required")
  process.exit(1)
}

const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL ?? "http://localhost:8180/api/v1/auth"
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD ?? "changeme123"

const pool = new pg.Pool({ connectionString: DB_URL })
await pool.query("SELECT 1")
console.log("✓ Database connected")

const db = drizzle(pool) as any

// Get all principals with emails that need auth provisioning
const principals = await db
  .select({
    id: principal.id,
    name: principal.name,
    slug: principal.slug,
    spec: principal.spec,
  })
  .from(principal)
  .where(
    sql`${principal.spec}->>'email' IS NOT NULL AND ${principal.spec}->>'email' != ''`
  )

console.log(`Found ${principals.length} principals with emails\n`)

let created = 0
let skipped = 0
let errors = 0

for (const p of principals) {
  const spec = p.spec as Record<string, unknown>
  const email = spec.email as string
  const name = (spec.displayName as string) ?? p.name ?? email.split("@")[0]
  const authUserId = spec.authUserId as string | undefined

  // Skip if already has a real (non-pending) authUserId
  if (authUserId && !authUserId.startsWith("pending:")) {
    skipped++
    continue
  }

  try {
    const res = await fetch(`${AUTH_BASE_URL}/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: DEFAULT_PASSWORD }),
    })

    if (!res.ok) {
      const body = await res.text()
      // If user already exists, try to look them up
      if (
        res.status === 422 ||
        body.includes("already exists") ||
        body.includes("UNIQUE")
      ) {
        console.log(`  [skip] ${email} — already registered`)
        skipped++
        continue
      }
      console.error(`  [error] ${email} — ${res.status}: ${body}`)
      errors++
      continue
    }

    const result = (await res.json()) as { user: { id: string } }
    const newAuthUserId = result.user.id

    // Update principal spec with the real authUserId
    await db
      .update(principal)
      .set({
        spec: sql`${principal.spec} || ${JSON.stringify({ authUserId: newAuthUserId })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(principal.id, p.id))

    console.log(`  [ok] ${email} → ${newAuthUserId}`)
    created++
  } catch (err) {
    console.error(`  [error] ${email}:`, err)
    errors++
  }
}

console.log(`\n✓ Done: created=${created} skipped=${skipped} errors=${errors}`)
await pool.end()
