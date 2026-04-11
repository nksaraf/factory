# Connection Contexts

A **connection context** is a resolved snapshot of all environment variables, tunnel configurations, and service dependencies needed to run a project against a particular target environment. It answers the question: "what env vars and port forwards do I need to work against staging instead of local?"

## The Problem

A project's `docker-compose.yaml` defines services and their ports. But in practice, developers frequently need to:

- Point a local frontend at a remote (staging/production) API instead of the local one.
- Replace a local Postgres with a shared development database.
- Run only a subset of services locally while tunnelling to the rest.

Hardcoding environment variables per environment creates drift. Connection contexts are the mechanism that makes this switching explicit, reproducible, and version-controlled.

## Key Types

```ts
// shared/src/connection-context-schemas.ts

export interface ResolvedConnectionContext {
  envVars: Record<string, ResolvedEnvEntry> // all env vars for this context
  tunnels: TunnelSpec[] // port forwards to open
  remoteDeps: string[] // services running remotely
  localDeps: string[] // services running locally
}

export interface ResolvedEnvEntry {
  value: string
  source: "default" | "tier" | "connection" | "cli"
  sourceDetail?: string // e.g. "profile:staging" or "--env flag"
}
```

`source` on each env var tells `dx dev` — and the developer — _why_ a variable has a particular value, making debugging much easier.

## Connection Profiles

Profiles are named environment overlays. They live in `.dx/profiles/` (or inside `dx` config in `package.json`) and describe how to connect to a particular environment:

```ts
export const connectionProfileSchema = z.object({
  description: z.string().optional(),
  connect: z.record(connectionProfileEntrySchema).default({}), // service → target
  env: z.record(z.string()).default({}), // env var overrides
})
```

A `connect` entry maps a local service name to a remote target. The entry can be a plain string (shorthand) or a full object:

```ts
export const connectionProfileEntrySchema = z.union([
  z.string(), // shorthand: "service@staging"
  z.object({
    target: z.string(), // remote service reference
    readonly: z.boolean().optional(),
    backend: tunnelBackendKindSchema.optional(), // direct | ssh | kubectl | gateway
    host: z.string().optional(), // explicit remote host
    port: z.number().optional(), // explicit remote port
    vars: z.record(z.string()).optional(), // compose interpolation overrides
  }),
])
```

### Tunnel backends

| Backend   | Mechanism                                          |
| --------- | -------------------------------------------------- |
| `direct`  | TCP connection to remote host:port (default)       |
| `ssh`     | `ssh -L` port forward                              |
| `kubectl` | `kubectl port-forward` to a Kubernetes pod/service |
| `gateway` | Route through Factory's API gateway                |

## Resolution Algorithm

`dx dev` and `dx connect` resolve a `ResolvedConnectionContext` in layers:

```mermaid
flowchart TD
    A[Compose labels\ncatalog.* + dx.*] -->|base ports & env| M[Merge engine]
    B[.env file\nproject root] -->|project defaults| M
    C[Connection profile\n.dx/profiles/NAME.yaml] -->|remote overrides| M
    D[System env\nPROCESS.env] -->|CI/shell overrides| M
    E[CLI flags\n--env KEY=VALUE] -->|explicit overrides| M
    M --> F[ResolvedConnectionContext]
```

Lower layers are overridden by higher layers. Every variable in the result carries its `source` so the developer can trace where each value came from.

### Step-by-step

1. **Parse compose catalog** — extract service ports and env var declarations from `docker-compose.yaml`.
2. **Load `.env`** — merge project-level defaults (lowest priority).
3. **Apply profile** — for each service in `profile.connect`, stop the local Docker container for that service and record a tunnel spec pointing at the remote target.
4. **Overlay `profile.env`** — explicit env var overrides from the profile.
5. **Inherit system env** — variables already set in the shell override profile values (useful in CI).
6. **Apply CLI flags** — `--env` arguments have the highest priority.

The tunnel specs are translated into actual port-forward processes by `dx dev` before development servers start.

## The Context File

Once resolved, the context is persisted to `.dx/.connection-context.yaml` so that subsequent `dx dev` invocations restore the same context without re-running resolution:

```ts
// cli/src/lib/connection-context-file.ts
const CONTEXT_FILE = join(".dx", ".connection-context.yaml")

export function writeConnectionContext(
  rootDir: string,
  ctx: ResolvedConnectionContext,
  extra?: ConnectionContextExtra
): void {
  /* ... */
}

export function readConnectionContext(
  rootDir: string
): (ResolvedConnectionContext & ConnectionContextExtra) | null {
  /* ... */
}
```

`ConnectionContextExtra` carries additional housekeeping:

```ts
export interface ConnectionContextExtra {
  stoppedServices?: string[] // Docker services stopped to make way for tunnels
  reconfiguredServices?: string[] // Services reconfigured with new env vars
}
```

This lets `dx dev --restore` bring the project back to its last-used configuration automatically.

### Compose override file

When remote connections are active, `dx dev` writes a `.connection-compose-override.yaml` (referenced by `COMPOSE_OVERRIDE_FILE`) that overrides env vars for local services that need to talk to remote peers. Docker Compose merges this on top of the base `docker-compose.yaml`.

## DX_TOKEN Authentication

When agents or automated tools need to call the Factory API, they authenticate with a `DX_TOKEN`. This is a pre-shared bearer token bound to a principal in the org schema.

The token is resolved through the same layered mechanism:

- Set as `DX_TOKEN` in the system environment for CI.
- Set in a connection profile's `env` block for team-shared credentials.
- Written to `.dx/.connection-context.yaml` by `dx login`.

The API validates `DX_TOKEN` at the authentication middleware layer before any route handler runs.

## TunnelSpec

Each tunnel that needs to be opened is described by a `TunnelSpec`:

```ts
export const tunnelSpecSchema = z.object({
  name: z.string(),
  localPort: z.number(),
  remoteHost: z.string(),
  remotePort: z.number(),
  namespace: z.string().optional(), // for kubectl backend
  backend: tunnelBackendKindSchema.default("direct"),
  connectionString: z.string().optional(), // e.g. postgres://...
})
```

The `connectionString` field allows the tunnel client to derive database URLs and other protocol-specific strings automatically, surfacing them as pre-built env vars in the resolved context.

## Example: switching to a remote database

```yaml
# .dx/profiles/staging.yaml
description: "Use staging Postgres, local everything else"
connect:
  postgres:
    target: "factory-staging/postgres"
    backend: kubectl
    namespace: factory
    vars:
      POSTGRES_USER: staging_user
      POSTGRES_PASSWORD: "${STAGING_DB_PASSWORD}"
env:
  APP_ENV: staging
  FEATURE_FLAGS_OVERRIDE: "true"
```

Running `dx dev --profile staging` would:

1. Stop the local `postgres` Docker container.
2. Open a `kubectl port-forward` to the `postgres` pod in the `factory` namespace on the staging cluster.
3. Set `DATABASE_URL` to `postgresql://staging_user:...@localhost:<localPort>/postgres`.
4. Set `APP_ENV=staging` and `FEATURE_FLAGS_OVERRIDE=true`.
5. Write the resolved context to `.dx/.connection-context.yaml`.

## See Also

- [Catalog System](/architecture/catalog-system) — how compose ports become tunnel targets
- [Reconciler](/architecture/reconciler) — how workloads the context connects to are kept running
- [Schema Design](/architecture/schemas) — where connection profiles are stored in the DB
