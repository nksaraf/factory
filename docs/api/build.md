# Build API

The `build` domain tracks the CI/CD and version management layer. It models **Repos** (source code repositories), **Git Host Providers** (GitHub, GitLab, Gitea connections), **System Versions** (cross-component version pins for a system), **Pipeline Runs** (CI job executions), and **Pipeline Steps** (individual stages within a run).

**Base prefix:** `/api/v1/factory/build`

## Endpoints

| Method   | Path                        | Description                                   |
| -------- | --------------------------- | --------------------------------------------- |
| `GET`    | `/repos`                    | List all repos                                |
| `GET`    | `/repos/:slug`              | Get a repo by slug                            |
| `POST`   | `/repos`                    | Register a repo                               |
| `PATCH`  | `/repos/:slug`              | Update repo metadata                          |
| `DELETE` | `/repos/:slug`              | Unregister a repo                             |
| `GET`    | `/git-host-providers`       | List all git host provider connections        |
| `GET`    | `/git-host-providers/:slug` | Get a provider by slug                        |
| `POST`   | `/git-host-providers`       | Register a git host provider                  |
| `PATCH`  | `/git-host-providers/:slug` | Update a git host provider                    |
| `DELETE` | `/git-host-providers/:slug` | Delete a git host provider                    |
| `GET`    | `/system-versions`          | List all system version records               |
| `GET`    | `/system-versions/:id`      | Get a system version by id                    |
| `POST`   | `/system-versions`          | Create a system version pin                   |
| `PATCH`  | `/system-versions/:id`      | Update a system version pin                   |
| `DELETE` | `/system-versions/:id`      | Delete a system version pin                   |
| `GET`    | `/pipeline-runs`            | List all pipeline runs                        |
| `GET`    | `/pipeline-runs/:id`        | Get a pipeline run by id                      |
| `POST`   | `/pipeline-runs`            | Create a pipeline run record                  |
| `PATCH`  | `/pipeline-runs/:id`        | Update a pipeline run (status, outputs, etc.) |
| `DELETE` | `/pipeline-runs/:id`        | Delete a pipeline run record                  |
| `GET`    | `/pipeline-steps`           | List all pipeline steps                       |
| `GET`    | `/pipeline-steps/:id`       | Get a pipeline step by id                     |
| `POST`   | `/pipeline-steps`           | Create a pipeline step record                 |
| `PATCH`  | `/pipeline-steps/:id`       | Update a pipeline step                        |
| `DELETE` | `/pipeline-steps/:id`       | Delete a pipeline step record                 |

## Query Parameters

All list endpoints accept:

| Parameter | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| `search`  | string | Full-text search across name, slug, and spec |
| `limit`   | number | Max results (default: 50, max: 500)          |
| `offset`  | number | Pagination offset                            |

Additional per-resource filters:

| Endpoint              | Extra Parameters                                                 |
| --------------------- | ---------------------------------------------------------------- |
| `/repos`              | `providerId`, `systemId`, `componentId`                          |
| `/git-host-providers` | `type` — `github`, `gitlab`, `gitea`, `bitbucket`                |
| `/system-versions`    | `systemId`, `status` — `draft`, `stable`, `deprecated`           |
| `/pipeline-runs`      | `repoId`, `componentId`, `status`, `trigger`, `branch`, `gitSha` |
| `/pipeline-steps`     | `pipelineRunId`, `status`, `name`                                |

## Examples

### Register a git host provider

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "github-example-org",
    "name": "GitHub — example org",
    "type": "github",
    "spec": {
      "host": "github.com",
      "org": "example",
      "appId": "12345",
      "installationId": "67890",
      "privateKeyRef": "secret:github-app-private-key",
      "webhookSecret": "encrypted:webhook_secret_abc",
      "syncStatus": "idle"
    }
  }' \
  "https://factory.example.com/api/v1/factory/build/git-host-providers"
```

### Register a repo

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "example-payments-api",
    "name": "payments-api",
    "providerId": "ghp_01hxgithubexample",
    "spec": {
      "url": "https://github.com/example/payments-api",
      "defaultBranch": "main",
      "cloneUrl": "git@github.com:example/payments-api.git",
      "visibility": "private",
      "language": "typescript",
      "topics": ["payments", "api"],
      "componentId": "comp_01hxpayapi",
      "systemId": "sys_01hxpayments",
      "ciConfigPath": ".github/workflows/ci.yml"
    }
  }' \
  "https://factory.example.com/api/v1/factory/build/repos"
```

### Create a system version pin

System versions let you pin a consistent set of component artifact versions across a system, decoupled from individual deployments.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "systemId": "sys_01hxpayments",
    "spec": {
      "version": "2.2.0",
      "status": "draft",
      "description": "Add recurring billing support",
      "components": [
        {
          "componentId": "comp_01hxpayapi",
          "artifactId": "art_01hxpayapiv220",
          "image": "ghcr.io/example/payments-api:v2.2.0",
          "gitSha": "a1b2c3d4"
        },
        {
          "componentId": "comp_01hxpayworker",
          "artifactId": "art_01hxpayworkv200",
          "image": "ghcr.io/example/payments-worker:v2.0.0",
          "gitSha": "e5f6g7h8"
        }
      ],
      "changelog": "feat: support recurring subscriptions\nfix: retry failed webhooks",
      "createdByPrincipalId": "prin_01hxalice"
    }
  }' \
  "https://factory.example.com/api/v1/factory/build/system-versions"
```

### Get a system version

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/build/system-versions/sysver_01hxpayv220"
```

```json
{
  "data": {
    "id": "sysver_01hxpayv220",
    "systemId": "sys_01hxpayments",
    "spec": {
      "version": "2.2.0",
      "status": "stable",
      "description": "Add recurring billing support",
      "components": [
        {
          "componentId": "comp_01hxpayapi",
          "artifactId": "art_01hxpayapiv220",
          "image": "ghcr.io/example/payments-api:v2.2.0",
          "gitSha": "a1b2c3d4"
        }
      ],
      "changelog": "feat: support recurring subscriptions",
      "promotedAt": "2026-04-10T16:00:00Z",
      "promotedByPrincipalId": "prin_01hxbob"
    },
    "createdAt": "2026-04-09T11:00:00Z",
    "updatedAt": "2026-04-10T16:00:00Z"
  }
}
```

### Create a pipeline run

CI systems push pipeline run records to Factory so deployments can be correlated with the builds that produced them.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repoId": "repo_01hxpayapi",
    "componentId": "comp_01hxpayapi",
    "spec": {
      "externalRunId": "github:run:987654321",
      "status": "running",
      "trigger": "push",
      "branch": "feat/recurring-billing",
      "gitSha": "a1b2c3d4",
      "prNumber": 142,
      "startedAt": "2026-04-10T11:00:00Z",
      "pipeline": "ci",
      "url": "https://github.com/example/payments-api/actions/runs/987654321"
    }
  }' \
  "https://factory.example.com/api/v1/factory/build/pipeline-runs"
```

### Update a pipeline run on completion

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "spec": {
      "status": "succeeded",
      "finishedAt": "2026-04-10T11:08:22Z",
      "durationSeconds": 502,
      "outputs": {
        "imageTag": "ghcr.io/example/payments-api:a1b2c3d4",
        "artifactId": "art_01hxpayapiv220"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/build/pipeline-runs/plrun_01hx987"
```

### Create pipeline steps

Steps are created (usually in batch) after the run starts to track individual stages.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pipelineRunId": "plrun_01hx987",
    "spec": {
      "name": "build-and-push",
      "status": "succeeded",
      "startedAt": "2026-04-10T11:01:00Z",
      "finishedAt": "2026-04-10T11:06:30Z",
      "durationSeconds": 330,
      "logs": "https://github.com/example/payments-api/actions/runs/987654321/jobs/111",
      "outputs": {
        "digest": "sha256:abc123def456"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/build/pipeline-steps"
```

### List recent pipeline runs for a component

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/build/pipeline-runs?componentId=comp_01hxpayapi&status=succeeded&limit=10"
```

## CLI equivalent

```bash
dx build repos list --json
dx build pipeline-runs list --component payments-api --limit 20 --json
dx build system-versions list --system payments-platform --status stable --json
```
