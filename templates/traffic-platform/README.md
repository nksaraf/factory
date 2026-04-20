# traffic-platform compose template

Factory-annotated `docker-compose.yaml` for the traffic-platform system (upstream
repo: `LeptonSoftware/traffic-platform`). Intended to be PR'd upstream alongside
the existing `docker-compose.yml`, not replace it.

## What this adds vs the existing `docker-compose.yml`

- `x-dx.name: traffic-platform` — declarative system slug read by `dx scan`
  (honoured via the `x-dx` override; otherwise scan falls back to the compose
  project dir, which differs across hosts — Sydney's dir is `trafficure`).
- `dx.*` labels on every service — type, owner, ports, APIs, docs, source
  repo/path, runtime.
- `dx.previous-slugs` on each service — forward-compatible rename hints so we
  can later move to the `infra-*` / `svc-*` / `app-*` / `init-*` archetype
  naming without orphaning catalog rows.

## What this deliberately does NOT change

- No service renames — brownfield containers, volumes, and networks stay bound
  to existing keys.
- No volume-key or network renames — data survives.
- No env var changes, healthcheck changes, or `depends_on` rewiring.

## How the PR rollout works

1. Land this file as `docker-compose.yaml` in `LeptonSoftware/traffic-platform`
   alongside `docker-compose.yml`.
2. Per VM: `git pull` → `docker compose -f docker-compose.yaml config` to
   validate → `docker compose -f docker-compose.yaml up -d`. Compose reuses
   existing containers/volumes.
3. Rollback: `docker compose -f docker-compose.yml up -d` restores the
   known-good file.
4. From the dev machine: `dx scan <host>` — components now land under the
   `traffic-platform` system with correct types (even on the Sydney host where
   the compose project dir is `trafficure`).

## Follow-ups (separate PRs)

- Rename services to archetype convention (`postgres` → `infra-postgres`,
  `traffic-platform` → `svc-core`, etc.) using the `dx.previous-slugs` hints
  already embedded here. Reconciler will migrate existing catalog rows instead
  of creating duplicates.
- Declare `traffic-airflow` compose with `x-dx.name: traffic-airflow` and a
  `product-system` link so the two systems that back the Trafficure product
  are explicit.
