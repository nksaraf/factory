# AI Agents

Factory treats AI agents as first-class principals — just like human users and service accounts.

## Agent Model

Agents have three key dimensions:

### Autonomy

| Level        | Description                         |
| ------------ | ----------------------------------- |
| `observer`   | Read-only, monitors and reports     |
| `advisor`    | Suggests actions, human approves    |
| `executor`   | Acts autonomously within guardrails |
| `operator`   | Full operational control            |
| `supervisor` | Manages other agents                |

### Collaboration

| Mode        | Description                |
| ----------- | -------------------------- |
| `solo`      | Works independently        |
| `pair`      | Works with one human       |
| `crew`      | Works in a team            |
| `hierarchy` | Part of an agent hierarchy |

### Relationship

| Scope      | Description             |
| ---------- | ----------------------- |
| `personal` | Serves one user         |
| `team`     | Serves a team           |
| `org`      | Serves the organization |

## Jobs and Threads

Agents receive **Jobs** — work units with priority and deadlines. Each job is discussed in a **Thread** — a universal conversation primitive that can be mirrored to multiple surfaces (IDE, Slack, terminal, GitHub).

```
Job created → Agent claims → Thread opened → Turns exchanged → Job completed
```

## Agent Memory

Agents learn and remember across sessions:

| Layer     | Scope               | Example                           |
| --------- | ------------------- | --------------------------------- |
| `session` | Single conversation | "User prefers terse responses"    |
| `team`    | Team-wide           | "This team uses Vitest, not Jest" |
| `org`     | Organization-wide   | "All PRs need 2 approvals"        |

Memory lifecycle: `proposed` → `approved` → `superseded`

## CLI Commands

```bash
dx agent list              # List registered agents
dx agent show my-agent     # Agent details
```

## For Agent Developers

All dx commands support `--json` for structured output:

```bash
dx status --json           # Structured health check
dx catalog list --json     # Browse catalog
dx db query --sql "..." --json  # Query databases
```

Authenticate via environment variable:

```bash
export DX_TOKEN=your-jwt-token
```

## MCP Integration

Agents access Factory tools via Model Context Protocol (MCP). Tool credentials are encrypted at rest and scoped per-agent.

## Related

- [org domain](/concepts/org)
- [API: org](/api/org)
