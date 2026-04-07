# dx Addenda — `dx s3` Rename & `dx secret` Design

**Addendum to: Observability & Object Storage doc + Unified Architecture**

---

# Part 1: `dx store` → `dx s3`

All references to `dx store` in the observability/storage doc are renamed to `dx s3`. The command surface is identical, just the noun changes:

```bash
dx s3 ls data/exports/ -l
dx s3 cp ./report.pdf data/reports/q1-2026.pdf
dx s3 cp data/exports/ ./local/ --recursive
dx s3 mv data/old.csv data/archive/old.csv
dx s3 rm data/temp/ --recursive --older-than 30d
dx s3 cat data/config.json

dx s3 sync ./data/ data/datasets/ --site trafficure-staging
dx s3 sync --from site-a:data/ --to site-b:data/
dx s3 sync --profile refresh-staging-geodata --dry-run

dx s3 presign data/exports/report.pdf --expires 24h
dx s3 du data/ --by-prefix
dx s3 find data/ --min-size 100MB --older-than 90d

dx s3 quota show --tenant samsung --site trafficure-prod-india
dx s3 lifecycle show --site trafficure-prod-india
dx s3 versioning enable data/datasets/
dx s3 versions data/datasets/boundaries.geojson
```

Why `dx s3` and not `dx blob`, `dx object`, `dx bucket`, or `dx files`:

- `s3` is universally understood — every developer knows what S3 operations look like
- MinIO speaks the S3 API, so the mental model is accurate
- It's short (two characters after `dx`)
- It doesn't collide with any other dx concept
- `dx files` sounds like local files, `dx object` is vague, `dx blob` is Azure terminology, `dx bucket` only covers half the operations

---

# Part 2: `dx secret` — Credential & Secret Management

## 2.1 Where Secrets Live in the Architecture

Secrets exist at three scopes, owned by different planes:

**Factory secrets** — credentials for Factory operations: git tokens, registry credentials, CI pipeline secrets, Jira API keys, Slack webhooks, DNS provider tokens, Proxmox API tokens. Owned by the plane that uses them (Build Plane owns git tokens, Infrastructure Plane owns Proxmox tokens, etc.). Stored in the Factory secret backend.

**Site secrets** — credentials for Site operations: database connection strings, third-party API keys for integrations, encryption keys for data-at-rest, mTLS certificates. Owned by the Site's planes (Control Plane owns auth signing keys, Data Plane owns database credentials, Service Plane owns integration API keys). Stored in the Site's secret backend.

**Module secrets** — per-module, per-tier credentials that modules need at runtime: `DATABASE_URL`, `STRIPE_KEY`, `SENDGRID_API_KEY`, `AWS_ACCESS_KEY_ID` for a module's S3 usage. These are the env vars that differ between local dev, staging, and production. Owned by the module team, stored in the secret backend, referenced in tier overlay files.

### The secret backend

dx supports three backends, configured per installation:

| Backend | When | How |
|---|---|---|
| **Vault** (HashiCorp) | Production installations, enterprise | dx talks to Vault's API, secrets are Vault paths |
| **External KMS** (AWS Secrets Manager, GCP Secret Manager) | Cloud installations | dx uses the cloud provider's secret API |
| **Internal encrypted store** | Development, small installations, air-gapped | Secrets encrypted at rest in Factory/Site PostgreSQL, key from Vault or local keyfile |

The CLI doesn't care which backend is active — the commands are the same. The backend is configured at install time and abstracted away.

## 2.2 The Reference Pattern

Secrets are never stored in `docker-compose.yaml`, tier overlays, or the Factory DB as plaintext. They're stored as **references** — URIs that point to the secret backend:

```yaml
# .dx/tiers/production.yaml
env:
  DATABASE_URL: vault://geoanalytics/production/database-url
  STRIPE_KEY: vault://geoanalytics/production/stripe-key
  SENDGRID_API_KEY: vault://geoanalytics/production/sendgrid-key
  ENCRYPTION_KEY: vault://geoanalytics/production/encryption-key

# .dx/tiers/staging.yaml
env:
  DATABASE_URL: vault://geoanalytics/staging/database-url
  STRIPE_KEY: vault://geoanalytics/staging/stripe-key-test
  SENDGRID_API_KEY: vault://geoanalytics/staging/sendgrid-key-test
```

When the reconciler deploys a workload, it resolves these references against the secret backend and injects the actual values as K8s Secrets. The plaintext values never touch the Factory DB, never appear in logs, and never transit the dx API.

For the internal encrypted store, the URI scheme is `secret://` instead of `vault://`:

```yaml
env:
  DATABASE_URL: secret://geoanalytics/production/database-url
```

## 2.3 Command Surface

### Module Secrets (what developers use daily)

```bash
# List secrets for current module
dx secret list                                        # lists secret keys (not values) for all tiers
dx secret list --tier production                      # list production secrets
dx secret list --tier staging

# Output:
#   KEY                  TIER         BACKEND   LAST ROTATED   REFERENCED BY
#   database-url         production   vault     12 days ago    api, worker, migrator
#   stripe-key           production   vault     45 days ago    api
#   sendgrid-key         production   vault     45 days ago    worker
#   encryption-key       production   vault     90 days ago    api, worker
#   database-url         staging      vault     12 days ago    api, worker, migrator
#   stripe-key-test      staging      vault     never          api

# Get a secret value (requires authorization, audited)
dx secret get database-url --tier production
  # ⚠ Showing production secret. This action is audited.
  # postgresql://geoanalytics:xK9m2...@prod-db.internal:5432/geoanalytics

dx secret get database-url --tier staging
  # postgresql://geoanalytics:dev123@staging-db.internal:5432/geoanalytics

# Set / update a secret
dx secret set database-url --tier staging \
  --value "postgresql://geoanalytics:newpass@staging-db.internal:5432/geoanalytics"

dx secret set stripe-key --tier production \
  --value "sk_live_..." \
  --reason "Rotated per quarterly schedule"

# Set from stdin (for long values, certificates, or piped from another tool)
cat new-cert.pem | dx secret set tls-cert --tier production --stdin

# Set from a file
dx secret set service-account-key --tier production --from-file ./sa-key.json

# Delete a secret
dx secret delete old-unused-key --tier staging --reason "Migrated to new auth provider"

# Copy secrets between tiers (useful when promoting)
dx secret copy database-url --from staging --to production
  # ⚠ This will overwrite the production value. Confirm? [type 'production' to confirm]
```

### Secret Resolution & Debugging

```bash
# Resolve all env vars for a component (shows where each value comes from)
dx secret resolve api --tier production
  # KEY                SOURCE                                     
  # DATABASE_URL       vault://geoanalytics/production/database-url
  # STRIPE_KEY         vault://geoanalytics/production/stripe-key  
  # SENDGRID_API_KEY   vault://geoanalytics/production/sendgrid-key
  # LOG_LEVEL          .dx/tiers/production.yaml (plaintext: "info")
  # PORT               docker-compose service port (plaintext: "8080")
  # REDIS_URL          .dx/tiers/production.yaml (plaintext)       

# Resolve AND show values (requires authorization for secret tiers)
dx secret resolve api --tier production --show-values
  # ⚠ Showing production secret values. This action is audited.
  # DATABASE_URL=postgresql://geoanalytics:xK9m2...@prod-db.internal:5432/geoanalytics
  # STRIPE_KEY=sk_live_...
  # ...

# Compare secrets across tiers (keys only, not values)
dx secret diff --from staging --to production
  # KEY              STAGING              PRODUCTION           STATUS
  # database-url     ✓ set                ✓ set                both set (different values)
  # stripe-key       ✓ set (test key)     ✓ set (live key)     both set (different values)  
  # debug-token      ✓ set                ✗ missing            staging only
  # encryption-key   ✗ missing            ✓ set                production only ⚠

# Validate that all referenced secrets exist in the backend
dx secret validate --tier production
  # ✓ database-url         exists in vault
  # ✓ stripe-key           exists in vault
  # ✓ sendgrid-key         exists in vault
  # ✗ new-feature-key      MISSING — referenced in .dx/tiers/production.yaml but not in vault
  #
  # 1 missing secret. Deployment will fail until this is resolved.
  #   dx secret set new-feature-key --tier production --value "..."

dx secret validate --tier staging
dx secret validate --all-tiers
```

### Secret Rotation

```bash
# Rotate a specific secret (generates new value if the backend supports it)
dx secret rotate database-url --tier production
  # For Vault: triggers Vault's dynamic secret rotation
  # For internal store: prompts for new value
  # Records rotation event, updates last-rotated timestamp

# Rotation status
dx secret rotation-status --tier production
  # KEY              LAST ROTATED    POLICY          STATUS
  # database-url     12 days ago     every 90 days   ✓ compliant
  # stripe-key       45 days ago     every 90 days   ✓ compliant
  # encryption-key   90 days ago     every 90 days   ⚠ due for rotation
  # sendgrid-key     180 days ago    every 90 days   ✗ overdue

# Rotation policies (defined per-secret or per-module)
dx secret rotation-policy set --key encryption-key --every 90d
dx secret rotation-policy set --module geoanalytics --default-every 90d

# After rotation, restart affected workloads to pick up new values
dx secret rotate database-url --tier production --restart
  # Rotates the secret AND restarts all workloads that reference it
  # Rolling restart — no downtime
```

### Infrastructure & Factory Secrets

```bash
# Infrastructure secrets (Proxmox tokens, cloud provider credentials)
dx secret list --scope infra
  # KEY                    BACKEND   USED BY
  # proxmox-prod-token     vault     dx infra vm/cluster/provider
  # proxmox-dev-token      vault     dx infra vm/cluster/provider
  # cloudflare-api-token   vault     dx infra dns
  # hetzner-api-token      vault     dx infra provider

dx secret set proxmox-prod-token --scope infra --value "PVEAPIToken=..."
dx secret get proxmox-prod-token --scope infra

# Build secrets (registry credentials, git tokens)
dx secret list --scope build
  # KEY                    BACKEND   USED BY
  # registry-push-token    vault     dx-builder
  # github-app-key         vault     github integration
  # sonar-token            vault     code quality pipeline

# Agent secrets (LLM API keys, tool credentials)
dx secret list --scope agent
  # KEY                    BACKEND   USED BY
  # anthropic-api-key      vault     factory-agent-orchestrator
  # ollama-endpoint        vault     air-gapped agent runtime

# Commerce secrets (Stripe keys, payment processor credentials)
dx secret list --scope commerce
  # KEY                    BACKEND   USED BY
  # stripe-secret-key      vault     factory-commerce-billing-worker
  # stripe-webhook-secret  vault     factory-commerce-api
```

### Site-Level Secrets (Ops)

```bash
# List secrets for a Site (ops/admin)
dx secret list --site trafficure-prod-india
  # KEY                    SCOPE      USED BY
  # auth-signing-key       control    site-control-auth (JWT signing)
  # db-root-password       data       site-data-postgres
  # minio-access-key       data       site-data-api (object storage)
  # otel-export-token      infra      otel-collector (telemetry export to factory)

# Rotate a Site-level secret
dx secret rotate auth-signing-key --site trafficure-prod-india
  # Generates new key, updates Site's Control Plane config
  # Existing tokens remain valid until expiry (graceful rotation)
```

## 2.4 How Secrets Flow Through the System

### At deploy time (reconciler resolves secrets → K8s Secrets)

```
docker-compose declares:  component api needs env vars
.dx/tiers/prod.yaml:     DATABASE_URL = vault://geoanalytics/production/database-url
                          STRIPE_KEY = vault://geoanalytics/production/stripe-key

Reconciler (on rollout):
  1. Reads workload env config
  2. Identifies secret references (vault:// or secret:// URIs)
  3. Resolves each reference against the backend (Vault API call)
  4. Creates K8s Secret: geoanalytics-api-env
  5. Mounts Secret as env vars in the pod
  6. The plaintext value exists only inside the K8s Secret and the pod's env

Factory DB stores:        only the URI (vault://...), never the plaintext
dx API never sees:        the actual secret value (reconciler resolves directly)
Audit log records:        "reconciler resolved 4 secrets for workload geoanalytics-api"
```

### At dev time (dx dev resolves secrets → local env)

```bash
dx dev api --connect-to staging

  1. dx reads .dx/tiers/staging.yaml
  2. Identifies secret references
  3. Resolves against Vault (developer must be authenticated to Vault)
  4. Injects as env vars into the local Docker Compose / process
  5. ⚠ Plaintext values are in the local process's environment
     (inherent to local dev — the developer is trusted with staging secrets)
```

For production connections:

```bash
dx dev api --connect postgres:production --readonly

  1. dx resolves the production DATABASE_URL from Vault
  2. Modifies it to use read-only credentials (if available as separate secret)
  3. Injects into local process
  4. Audited: "nikhil resolved production secret database-url for local dev"
```

### At dx secret get time (developer inspects a secret)

```bash
dx secret get stripe-key --tier production

  1. dx checks SpiceDB: does this principal have secret:read on this secret path?
  2. If authorized: resolves from Vault, displays value
  3. Audit log: "nikhil read secret geoanalytics/production/stripe-key"
  4. Value is displayed in terminal, never cached to disk
```

## 2.5 Authorization Model

| Operation | Sandbox/Dev | Staging | Production | Infrastructure |
|---|---|---|---|---|
| `dx secret list` (keys only) | Team member | Team member | Team member | Infra team |
| `dx secret get` (show value) | Team member | Team member | Requires `secret:read` grant | Infra admin |
| `dx secret set` (create/update) | Team member | Team member | Requires `secret:write` grant | Infra admin |
| `dx secret delete` | Team member | Team lead | Platform admin | Platform admin |
| `dx secret rotate` | N/A | Team lead | Platform admin | Platform admin |
| `dx secret resolve --show-values` | Team member | Team member | Requires `secret:read` grant | Infra admin |

Listing secret keys (without values) is broadly allowed — developers need to know what secrets exist to debug configuration issues. Showing values is the privileged operation.

## 2.6 Vault Integration Details

When Vault is the backend, dx maps secrets to Vault paths following a consistent convention:

```
Vault path structure:
  secret/dx/{scope}/{tier-or-site}/{key}

Examples:
  secret/dx/module/geoanalytics/production/database-url
  secret/dx/module/geoanalytics/staging/database-url
  secret/dx/module/auth/production/signing-key
  secret/dx/infra/proxmox-prod-token
  secret/dx/build/github-app-key
  secret/dx/commerce/stripe-secret-key
  secret/dx/site/trafficure-prod-india/auth-signing-key
  secret/dx/site/trafficure-prod-india/db-root-password
```

Vault policies are generated by dx to match the authorization model:

```hcl
# Team members can read/write their module's staging secrets
path "secret/dx/module/geoanalytics/staging/*" {
  capabilities = ["read", "create", "update"]
}

# Team members can list (but not read) their module's production secrets
path "secret/dx/module/geoanalytics/production/*" {
  capabilities = ["list"]
}

# Principals with secret:read grant can read production secrets
# (managed by SpiceDB, enforced at dx API layer — Vault policy is broader,
#  dx narrows access based on SpiceDB check before proxying to Vault)
```

### Vault authentication

dx authenticates to Vault via:

1. **Kubernetes auth** (in-cluster) — reconciler and platform services use K8s service account tokens
2. **OIDC auth** (CLI) — developers authenticate to Vault via the same SSO they use for dx
3. **AppRole** (CI) — build pipelines use AppRole credentials
4. **Token** (fallback) — for air-gapped or simple installations

```yaml
# Factory config
secrets:
  backend: vault
  vault:
    url: https://vault.internal:8200
    auth: kubernetes                    # for in-cluster services
    cli-auth: oidc                      # for developer CLI access
    ci-auth: approle                    # for CI pipelines
    mount: secret/dx
```

### Internal encrypted store (when Vault isn't available)

For development environments, small installations, or air-gapped deployments without Vault:

```yaml
secrets:
  backend: internal
  internal:
    encryption: aes-256-gcm
    key-source: file                    # file | env | kms
    key-path: /etc/dx/secret-key        # only for key-source: file
```

Secrets are stored in the Factory/Site PostgreSQL database, encrypted at rest with AES-256-GCM. The encryption key comes from a local file (for air-gapped), an environment variable (for containers), or a cloud KMS (for hybrid setups).

The internal store supports the same `dx secret` commands. The URI scheme is `secret://` instead of `vault://`. Migration from internal to Vault is a one-time operation: `dx secret migrate --from internal --to vault`.

## 2.7 Secret Injection Patterns for Components

Modules receive secrets as environment variables. The Service Plane SDK provides helpers, but the fundamental mechanism is env vars — the most universal, framework-agnostic method.

```yaml
# .dx/tiers/production.yaml
env:
  # Secret references (resolved by reconciler from Vault/internal store)
  DATABASE_URL: vault://geoanalytics/production/database-url
  STRIPE_KEY: vault://geoanalytics/production/stripe-key
  ENCRYPTION_KEY: vault://geoanalytics/production/encryption-key

  # Plaintext config (not sensitive — stored directly in tier file)
  LOG_LEVEL: info
  RATE_LIMIT: 100
  FEATURE_NEW_COVERAGE: "true"
```

At deploy time, the reconciler creates a K8s Secret with the resolved values and references it in the pod spec. The pod sees env vars — it doesn't know whether the value came from Vault, the internal store, or a plaintext config.

### File-mounted secrets

Some tools need secrets as files (TLS certificates, service account JSON keys, SSH keys). The tier config supports this:

```yaml
# .dx/tiers/production.yaml
env:
  DATABASE_URL: vault://geoanalytics/production/database-url

files:
  /etc/geoanalytics/tls.crt: vault://geoanalytics/production/tls-cert
  /etc/geoanalytics/tls.key: vault://geoanalytics/production/tls-key
  /etc/geoanalytics/sa-key.json: vault://geoanalytics/production/gcp-service-account
```

The reconciler mounts these as K8s Secret volumes at the specified paths.

## 2.8 Conventions for Secret Hygiene

```yaml
# .dx/conventions.yaml (addition)
secrets:
  # Require all production env vars that look like secrets to be vault:// references
  # (catches people putting plaintext passwords in tier files)
  require-references:
    tiers: [production, staging]
    patterns:                             # env var names that must be secret references
      - "*_KEY"
      - "*_SECRET"
      - "*_PASSWORD"
      - "*_TOKEN"
      - "*_URL"                           # database URLs often contain passwords
      - "*_DSN"

  # Rotation policy
  rotation:
    default: 90d
    critical: 30d                         # encryption keys, signing keys
    warn-before: 14d                      # alert this many days before rotation is due

  # Prevent secrets in code
  pre-commit:
    scan-for-secrets: true                # run secret scanner on every commit
    block-on-detection: true              # block commit if secrets detected
```

The convention engine checks tier files on PR:

```
$ dx push

  ✗ Convention violation: secrets.require-references

  .dx/tiers/production.yaml line 4:
    STRIPE_KEY: sk_live_abc123xyz...

  This looks like a plaintext secret in a production tier file.
  Production secrets must be stored in Vault and referenced as vault:// URIs.

  Fix:
    dx secret set stripe-key --tier production --value "sk_live_abc123xyz..."
    # Then update .dx/tiers/production.yaml:
    #   STRIPE_KEY: vault://geoanalytics/production/stripe-key
```

## 2.9 Complete Command Reference

```
MODULE SECRETS (per-module, per-tier)
  dx secret list [--tier <tier>]
  dx secret get <key> --tier <tier>
  dx secret set <key> --tier <tier> --value | --stdin | --from-file
  dx secret delete <key> --tier <tier> --reason
  dx secret copy <key> --from <tier> --to <tier>

SECRET RESOLUTION & DEBUGGING
  dx secret resolve <component> --tier <tier> [--show-values]
  dx secret diff --from <tier> --to <tier>
  dx secret validate --tier <tier> | --all-tiers

ROTATION
  dx secret rotate <key> --tier <tier> [--restart]
  dx secret rotation-status --tier <tier>
  dx secret rotation-policy set --key <key> --every <duration>
  dx secret rotation-policy set --module <module> --default-every <duration>

INFRASTRUCTURE & FACTORY SECRETS
  dx secret list --scope infra | build | agent | commerce
  dx secret get <key> --scope <scope>
  dx secret set <key> --scope <scope> --value | --stdin | --from-file

SITE-LEVEL SECRETS
  dx secret list --site <site>
  dx secret get <key> --site <site>
  dx secret set <key> --site <site> --value | --stdin | --from-file
  dx secret rotate <key> --site <site>

BACKEND MANAGEMENT
  dx secret backend status                             # which backend is active, health
  dx secret migrate --from internal --to vault         # one-time migration
```
