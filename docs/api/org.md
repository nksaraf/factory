# Org API

The `org` domain covers the people, agents, and coordination primitives that make up your organization. It owns the "who" of the platform: teams, principals (human, agent, and service-account), memberships, the agent model (agents, jobs, memory), and conversational threads.

**Base prefix:** `/api/v1/factory/org`

## Endpoints

| Method   | Path                    | Description                      |
| -------- | ----------------------- | -------------------------------- |
| `GET`    | `/teams`                | List all teams                   |
| `GET`    | `/teams/:slug`          | Get a team by slug               |
| `POST`   | `/teams`                | Create a team                    |
| `PATCH`  | `/teams/:slug`          | Update a team                    |
| `DELETE` | `/teams/:slug`          | Delete a team                    |
| `GET`    | `/principals`           | List all principals              |
| `GET`    | `/principals/:slug`     | Get a principal by slug          |
| `POST`   | `/principals`           | Create a principal               |
| `PATCH`  | `/principals/:slug`     | Update a principal               |
| `DELETE` | `/principals/:slug`     | Delete a principal               |
| `GET`    | `/memberships`          | List all memberships             |
| `GET`    | `/memberships/:id`      | Get a membership by id           |
| `POST`   | `/memberships`          | Add a principal to a team        |
| `PATCH`  | `/memberships/:id`      | Update membership role           |
| `DELETE` | `/memberships/:id`      | Remove a principal from a team   |
| `GET`    | `/agents`               | List all agents                  |
| `GET`    | `/agents/:slug`         | Get an agent by slug             |
| `POST`   | `/agents`               | Create an agent                  |
| `PATCH`  | `/agents/:slug`         | Update an agent                  |
| `DELETE` | `/agents/:slug`         | Delete an agent                  |
| `GET`    | `/jobs`                 | List all agent jobs              |
| `GET`    | `/jobs/:id`             | Get a job by id                  |
| `POST`   | `/jobs`                 | Create a job                     |
| `PATCH`  | `/jobs/:id`             | Update a job                     |
| `POST`   | `/jobs/:id/complete`    | Mark a job complete              |
| `POST`   | `/jobs/:id/fail`        | Mark a job failed                |
| `POST`   | `/jobs/:id/override`    | Override a job with a note       |
| `GET`    | `/threads`              | List all threads                 |
| `GET`    | `/threads/:slug`        | Get a thread by slug             |
| `POST`   | `/threads`              | Create a thread                  |
| `PATCH`  | `/threads/:slug`        | Update a thread                  |
| `DELETE` | `/threads/:slug`        | Delete a thread                  |
| `GET`    | `/thread-turns`         | List turns (filter by threadId)  |
| `GET`    | `/thread-turns/:id`     | Get a turn by id                 |
| `POST`   | `/thread-turns`         | Append a turn to a thread        |
| `GET`    | `/memory`               | List memory records              |
| `GET`    | `/memory/:id`           | Get a memory record by id        |
| `POST`   | `/memory`               | Propose a new memory record      |
| `PATCH`  | `/memory/:id`           | Update a memory record           |
| `DELETE` | `/memory/:id`           | Archive a memory record          |
| `POST`   | `/memory/:id/approve`   | Approve a proposed memory        |
| `POST`   | `/memory/:id/supersede` | Mark a memory superseded         |
| `POST`   | `/memory/:id/promote`   | Promote memory to a higher layer |

## Query Parameters

All list endpoints accept the following common parameters:

| Parameter | Type   | Description                                   |
| --------- | ------ | --------------------------------------------- |
| `search`  | string | Full-text search across name, slug, and spec  |
| `limit`   | number | Max results to return (default: 50, max: 500) |
| `offset`  | number | Pagination offset                             |
| `type`    | string | Filter by entity type (e.g., `team`, `human`) |

Additional per-resource filters:

| Endpoint        | Extra Parameters                                |
| --------------- | ----------------------------------------------- |
| `/teams`        | `parentTeamId` — filter by parent team          |
| `/principals`   | `type` — `human`, `agent`, or `service-account` |
| `/memberships`  | `teamId`, `principalId`, `role`                 |
| `/agents`       | `type`, `status` — `active` or `disabled`       |
| `/jobs`         | `agentId`, `status`, `mode`, `trigger`          |
| `/threads`      | `principalId`, `agentId`, `status`              |
| `/thread-turns` | `threadId` (required for useful results)        |
| `/memory`       | `layer` — `session`, `team`, or `org`; `status` |

## Examples

### List teams

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/org/teams?limit=20&search=platform"
```

```json
{
  "data": [
    {
      "id": "team_01hx4k9p2m",
      "slug": "platform-eng",
      "name": "Platform Engineering",
      "type": "team",
      "parentTeamId": "team_01hx4k9p00",
      "spec": {
        "description": "Owns the internal developer platform and dx CLI",
        "slackChannel": "#platform-eng",
        "oncallUrl": "https://pagerduty.example.com/schedules/P123"
      },
      "metadata": {
        "labels": { "cost-center": "infra" },
        "tags": ["platform", "internal"]
      },
      "createdAt": "2025-01-10T08:00:00Z",
      "updatedAt": "2026-03-15T14:22:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 4 }
}
```

### Create a team

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "data-platform",
    "name": "Data Platform",
    "type": "team",
    "parentTeamId": "team_01hx4k9p00",
    "spec": {
      "description": "Owns data infrastructure and pipelines",
      "slackChannel": "#data-platform"
    }
  }' \
  "https://factory.example.com/api/v1/factory/org/teams"
```

### Create a principal (human)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "alice",
    "name": "Alice Chen",
    "type": "human",
    "spec": {
      "email": "alice@example.com",
      "displayName": "Alice Chen",
      "status": "active",
      "avatarUrl": "https://avatars.example.com/alice"
    }
  }' \
  "https://factory.example.com/api/v1/factory/org/principals"
```

### Create an agent

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "copilot-eng",
    "name": "Engineering Copilot",
    "type": "engineering",
    "principalId": "prin_01hx4k9p3q",
    "spec": {
      "autonomyLevel": "executor",
      "relationship": "team",
      "collaborationMode": "pair",
      "model": "claude-opus-4",
      "systemPrompt": "You are an engineering assistant. Help the team write, review, and debug code.",
      "capabilities": {
        "bash": true,
        "fileEdit": true,
        "webSearch": false
      },
      "guardrails": {
        "requireApprovalFor": ["git push", "dx deploy"]
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/org/agents"
```

### Complete a job

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "outcome": {
      "prUrl": "https://github.com/example/repo/pull/42",
      "summary": "Refactored auth middleware"
    },
    "costCents": 14
  }' \
  "https://factory.example.com/api/v1/factory/org/jobs/job_01hx4k9p5r/complete"
```

### Propose a memory record

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "preference",
    "layer": "team",
    "sourceAgentId": "agent_01hx4k9p6s",
    "spec": {
      "content": "The team prefers conventional commits with a ticket number in the footer",
      "confidence": 0.9,
      "source": "conversation:thread_01hx4k9p7t"
    }
  }' \
  "https://factory.example.com/api/v1/factory/org/memory"
```

### Approve a proposed memory

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "approvedByPrincipalId": "prin_01hx4k9p3q" }' \
  "https://factory.example.com/api/v1/factory/org/memory/mem_01hx4k9p8u/approve"
```

## CLI equivalent

All org endpoints are accessible via the `dx` CLI. Pass `--json` to receive machine-readable output:

```bash
dx org teams list --json
dx org agents get copilot-eng --json
dx org memory list --layer team --json
```
