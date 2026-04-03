# Chat SDK Conversational Agent Layer — Design Spec

**Date:** 2026-03-28
**Status:** Draft
**Depends on:** Agent Platform v1 (taxonomy, jobs, memory), Messaging tables (factory_org)

## Context

The Factory platform needs a conversational AI interface where users can interact with agents via Slack (and later other platforms). Users should be able to @mention an agent and have it perform actions ranging from quick CLI operations ("create a JIRA ticket") to full coding workflows ("fix the login bug, create a PR, deploy a preview").

This spec covers the integration of Vercel's [Chat SDK](https://chat-sdk.dev) as the conversational transport layer, [Vercel Workflow](https://vercel.com/docs/workflow) for durable multi-step sessions, and [Vercel AI SDK](https://sdk.vercel.ai) for LLM-powered tool calling.

**Key design decisions:**
- Chat SDK handles platform abstraction (Slack webhooks, streaming, interactive components)
- Vercel Workflow handles durable execution (multi-step workflows that survive restarts)
- Agents use Claude Code-style tools (bash, read, write, edit, grep, glob, ask_user) rather than per-operation tools
- The `dx` CLI is the primary interface for factory operations — agents discover and drive the factory through the CLI
- A separate "agent skill" (system prompt + tool configs) is a follow-up deliverable
- The bot calls the Factory API for all data/action operations (no direct DB access)

**Out of scope:**
- Agent skill definition (system prompt, tool configurations) — separate deliverable
- Web UI chat interface (future — same backend, different transport)
- Non-Slack platforms (architecture supports them via Chat SDK adapters, not built in v1)

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  agent-chat (Next.js app)                                    │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Chat SDK     │  │ Vercel       │  │ AI SDK             │  │
│  │ + Slack      │  │ Workflow     │  │ (streamText +      │  │
│  │   adapter    │  │ (durable)    │  │  tool calling)     │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────────┘  │
│         │                 │                   │               │
│  ┌──────▼─────────────────▼───────────────────▼────────────┐  │
│  │              Agent Handler Layer                        │  │
│  │  • Identity resolution (via Factory API)                │  │
│  │  • Channel context resolution                           │  │
│  │  • Job creation/resumption                              │  │
│  │  • Execution mode selection (lightweight vs sandbox)     │  │
│  │  • Context building (memories + channel + user)          │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                     │
│  ┌──────────────────────▼──────────────────────────────────┐  │
│  │         Custom State Adapter                            │  │
│  │  • Thread subscriptions → factory_org.message_thread    │  │
│  │  • Thread state → message_thread.metadata               │  │
│  │  • Distributed locks → Redis                            │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Factory API (existing Elysia server)                        │
│  • /agent/* (agents, jobs, presets)                           │
│  • /memory/* (org/team/session memories)                      │
│  • /messaging/* (providers, channels, identity)               │
│  • /infra/* (sandboxes, previews)                             │
│  • /build/* (repos, artifacts, PRs)                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Package Structure

New Next.js app in the monorepo:

```
agent-chat/
├── package.json
│   dependencies:
│     chat, @chat-adapter/slack, @chat-adapter/state-pg
│     @vercel/workflow
│     ai, @ai-sdk/anthropic
│
├── next.config.ts
├── .env.local
│   SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
│   FACTORY_API_URL
│   REDIS_URL
│   ANTHROPIC_API_KEY
│
├── src/
│   ├── bot.ts                          ← Chat instance + event handlers
│   ├── app/
│   │   └── api/
│   │       └── webhooks/
│   │           └── [platform]/
│   │               └── route.ts        ← Webhook endpoint for Chat SDK
│   │
│   ├── workflows/
│   │   ├── conversation.ts             ← Durable conversation workflow
│   │   └── steps/
│   │       ├── resolve-context.ts      ← Identity + channel + memory resolution
│   │       ├── ai-turn.ts             ← Single LLM turn with tool calling
│   │       ├── sandbox-exec.ts         ← Sandbox creation + coding task execution
│   │       └── wait-for-user.ts        ← Pause workflow for user input
│   │
│   ├── tools/
│   │   ├── bash.ts                     ← Execute shell commands (dx CLI, git, etc.)
│   │   ├── read-file.ts               ← Read files (in sandbox)
│   │   ├── write-file.ts              ← Write files (in sandbox)
│   │   ├── edit-file.ts               ← Edit files — find/replace (in sandbox)
│   │   ├── grep.ts                     ← Search file contents (in sandbox)
│   │   ├── glob.ts                     ← Find files by pattern (in sandbox)
│   │   ├── ask-user.ts                ← Post question to Slack, wait for response
│   │   └── web-fetch.ts               ← Fetch URL content
│   │
│   ├── state/
│   │   └── factory-state-adapter.ts    ← Custom Chat SDK state adapter
│   │
│   └── lib/
│       ├── factory-client.ts           ← HTTP client for Factory API
│       ├── context-builder.ts          ← Builds system prompt from memories + context
│       └── execution-mode.ts           ← Decides lightweight vs sandbox mode
```

---

## 3. Event Handling (bot.ts)

The Chat SDK `Chat` instance handles three event types:

### 3.1 New Mention (`onNewMention`)

Entry point for new conversations. When a user @mentions the bot:

1. Subscribe to the thread (so subsequent messages route to `onSubscribedMessage`)
2. Resolve identity: Slack user → `orgPrincipal` (via `identityLink`)
3. Resolve channel context: Slack channel → entity mapping (via `channelMapping`)
4. Start a durable Workflow
5. Store the workflow `runId` in thread state

### 3.2 Subscribed Message (`onSubscribedMessage`)

Subsequent messages in an active thread:

1. Read thread state to get `runId`
2. Resume the existing Workflow with the new message via `resumeHook`

### 3.3 Action (`onAction`)

Button clicks and interactive component responses:

1. Read thread state to get `runId`
2. Resume the Workflow with the action payload

---

## 4. Durable Conversation Workflow

Each conversation is a Vercel Workflow that:

1. **Resolves context** (identity, channel, memories) — one-time setup step
2. **Creates a Factory job** — tracks the conversation as a unit of work
3. **Runs a conversation loop:**
   - Execute an AI turn (LLM + tools)
   - Stream response to Slack
   - If the agent needs user input → pause (durable wait)
   - If the agent is done → complete the job
   - Otherwise → wait for next user message, loop

The workflow is durable — it survives process restarts, deployments, and cold starts. The Workflow SDK persists state between steps.

### 4.1 Conversation Loop

```
Start → Resolve Context → Create Job → AI Turn ←─┐
                                          │        │
                                    ┌─────▼─────┐  │
                                    │ Done?      │  │
                                    └──┬─────┬──┘  │
                                   yes │     │ no   │
                                       ▼     ▼     │
                              Complete Job   Wait  │
                                          for user │
                                             │     │
                                             └─────┘
```

### 4.2 AI Turn

Each AI turn uses `streamText` from the AI SDK with:

- **Model:** Claude (configurable via agent's `config.defaultModelId`)
- **System prompt:** Built from org memories + team memories + channel context + user context
- **Messages:** Full conversation history from the thread
- **Tools:** bash, read, write, edit, grep, glob, ask_user, web_fetch
- **Max steps:** 10 (allows multi-step tool use within a single turn)
- **Streaming:** Chunks streamed to Slack via `thread.stream()` in real-time

---

## 5. Execution Modes

The agent operates in two modes, selected dynamically based on the task:

### 5.1 Lightweight Mode (no sandbox)

For quick operations that don't require code changes:

- Creating issues/tickets
- Checking PR status
- Getting deployment info
- Querying the codebase (read-only)
- Managing factory resources (agents, teams, etc.)

The `bash` tool executes `dx` CLI commands directly in the Chat SDK process (or a thin container). File tools (`read`, `write`, `edit`, `grep`, `glob`) are not available in this mode.

**Examples:**
```
"Create a JIRA ticket for the auth timeout" → dx issue create ...
"What's the status of PR #456?"              → dx pr status 456
"List all sandboxes for auth-service"        → dx sandbox list --module auth-service
```

### 5.2 Sandbox Mode (code changes)

For tasks requiring code modifications:

- Fixing bugs
- Writing features
- Refactoring code
- Writing tests

The workflow:
1. Creates a sandbox via Factory API
2. Runs the coding agent inside the sandbox with full tool access
3. Streams progress updates to Slack
4. On completion: creates a PR, optionally deploys a preview
5. Posts results with interactive components (approve/reject buttons via `ask_user`)

**Mode selection logic:**
All conversations start in lightweight mode (bash tool has `dx` CLI access). If the LLM's tool calls require file operations (`read_file`, `write_file`, `edit_file`) or the LLM explicitly requests a sandbox via `bash("dx sandbox create ...")`, the system spins up a sandbox and makes file tools available. This is a one-way escalation within a conversation — once a sandbox is created, all subsequent tool calls execute inside it.

---

## 6. Tool Definitions

Tools mirror Claude Code's primitives. The agent skill (system prompt) teaches the agent how to use them effectively. Tool definitions are standard AI SDK `tool()` objects.

### 6.1 `bash`

Execute shell commands. In lightweight mode: `dx` CLI, `curl`, basic shell. In sandbox mode: full shell access (git, npm, build tools, etc.).

- Parameters: `command: string`, `timeout?: number`
- Returns: `{ stdout: string, stderr: string, exitCode: number }`

### 6.2 `read_file`

Read file contents. Sandbox mode only.

- Parameters: `path: string`, `offset?: number`, `limit?: number`
- Returns: file contents with line numbers

### 6.3 `write_file`

Write/create a file. Sandbox mode only.

- Parameters: `path: string`, `content: string`
- Returns: confirmation

### 6.4 `edit_file`

Find and replace in a file. Sandbox mode only.

- Parameters: `path: string`, `old_string: string`, `new_string: string`
- Returns: confirmation with context

### 6.5 `grep`

Search file contents with regex. Available in both modes (lightweight uses `dx` CLI search, sandbox uses ripgrep).

- Parameters: `pattern: string`, `path?: string`, `glob?: string`
- Returns: matching lines with file paths and line numbers

### 6.6 `glob`

Find files by pattern. Available in both modes.

- Parameters: `pattern: string`, `path?: string`
- Returns: list of matching file paths

### 6.7 `ask_user`

Post a question to the Slack thread and pause the workflow until the user responds. This is the primary interaction mechanism — the agent dynamically decides when to ask for input.

- Parameters: `question: string`, `options?: string[]`
- Behavior:
  - If `options` provided → renders as Slack buttons (card with action buttons)
  - If no `options` → posts as plain text, waits for next message
- Returns: the user's response (text or button value)

This replaces pre-defined Slack button patterns. The agent decides what to ask based on context, making interactions natural and adaptive.

### 6.8 `web_fetch`

Fetch and extract content from a URL.

- Parameters: `url: string`, `prompt?: string`
- Returns: page content (markdown)

---

## 7. Custom State Adapter

Bridges Chat SDK's state interface to existing Factory tables:

| Chat SDK operation | Factory implementation |
|---|---|
| `subscribe(threadId)` | `getOrCreateThread()` in `factory_org.message_thread` |
| `unsubscribe(threadId)` | Set thread status to `resolved` |
| `isSubscribed(threadId)` | Check thread status === `active` |
| `getState(threadId)` | Read `message_thread.metadata` JSONB |
| `setState(threadId, state)` | Update `message_thread.metadata` |
| `acquireLock(key, ttl)` | Redis `SET key NX EX ttl` |
| `releaseLock(key)` | Redis `DEL key` |

Thread ID format: `slack:<channelId>:<threadTs>` — parsed into `messagingProviderId`, `externalChannelId`, `externalThreadId` for DB lookups.

---

## 8. Factory API Client

The bot never accesses the database directly. All operations go through the Factory API:

```
Identity:
  GET  /messaging/providers/:id/resolve-user?externalUserId=X
  → Returns principalId or null

Channel Context:
  GET  /messaging/providers/:id/channels?externalChannelId=X
  → Returns { entityKind, entityId } mapping

Jobs:
  POST /agent/jobs                    → Create job
  POST /agent/jobs/:id/start          → Mark running
  POST /agent/jobs/:id/complete       → Mark succeeded
  POST /agent/jobs/:id/fail           → Mark failed

Memory:
  GET  /memory/memories?orgId=X&layer=org&status=active
  GET  /memory/memories?layer=team&layerEntityId=<teamId>&status=active

Threads:
  POST /messaging/providers/:id/threads  → Get or create
  POST /messaging/threads/:id/messages   → Append message

Sandboxes:
  POST   /infra/sandboxes              → Create sandbox
  GET    /infra/sandboxes/:id          → Check status
  DELETE /infra/sandboxes/:id          → Cleanup

Agents:
  GET  /agent/agents/:idOrSlug        → Get agent config, preset, autonomy
```

---

## 9. Context Building

Before each AI turn, the system builds a context that includes:

1. **Agent identity:** Name, role preset, autonomy level, guardrails
2. **Org memories:** Company-wide conventions, policies (layer=org, status=active)
3. **Team memories:** Team-specific context (layer=team, layerEntityId=teamId)
4. **Channel context:** What entity this channel maps to (module, team, domain)
5. **User context:** Who is talking (principal name, role, team, preferences from identity link)
6. **Conversation history:** All messages in the thread so far

This is assembled into a system prompt by `context-builder.ts`. The specific prompt template is defined in the agent skill (separate deliverable), but the builder provides the structured data.

---

## 10. Interaction Flow Examples

### Example 1: Quick CLI Operation

```
User: "@factory-agent create a bug ticket for the login timeout issue"

1. onNewMention → subscribe, start workflow
2. Resolve: user=Nikhil (prin_xxx), channel=#auth-team → module=auth-service
3. Create job: mode=conversational, trigger=mention
4. AI turn:
   LLM decides: this is a ticket creation, use dx CLI
   Tool call: bash("dx issue create --title 'Login timeout bug' --module auth-service --type bug")
   Result: "Created issue AUTH-42"
5. Stream to Slack: "Created bug ticket AUTH-42: Login timeout bug"
6. Job complete
```

### Example 2: Code Fix with PR

```
User: "@factory-agent the session token expiry is set to 0, can you fix it?"

1. onNewMention → subscribe, start workflow
2. Resolve context (identity, channel, memories)
3. Create job: mode=conversational, trigger=mention
4. AI turn 1:
   LLM decides: needs code changes → sandbox mode
   Tool call: bash("dx sandbox create --module auth-service")
   Tool call: bash("dx sandbox exec sbx_xxx -- grep -r 'tokenExpiry' src/")
   Result: "Found in src/auth.ts:42: tokenExpiry: 0"
   Tool call: ask_user("Found `tokenExpiry: 0` in auth.ts:42. Should I change it to 3600 (1 hour)?", ["Yes, 1 hour", "Set to 24 hours", "Let me specify"])
5. Workflow PAUSES — waiting for user
6. User clicks: "Yes, 1 hour"
7. AI turn 2:
   Tool call: edit_file("src/auth.ts", "tokenExpiry: 0", "tokenExpiry: 3600")
   Tool call: bash("npm test")
   Tests pass
   Tool call: bash("git add -A && git commit -m 'fix: set session token expiry to 1 hour'")
   Tool call: bash("dx pr create --title 'Fix session token expiry'")
   Result: "Created PR #456"
   Tool call: bash("dx preview create --pr 456")
   Result: "Preview: https://preview-456.factory.dev"
   Tool call: ask_user("PR #456 ready. Preview: https://preview-456.factory.dev", ["Approve & Merge", "Request Changes", "I'll review manually"])
8. Workflow PAUSES — waiting for user
9. User clicks: "Approve & Merge"
10. AI turn 3:
    Tool call: bash("dx pr merge 456")
    Stream: "Merged PR #456. Deploying to staging."
11. Job complete (outcome: { pr: 456, merged: true })
```

### Example 3: Multi-Step with Delegation

```
User: "@factory-agent the billing page is broken, can you investigate and fix?"

1-3. Setup (same as above)
4. AI turn 1:
   Tool call: bash("dx sandbox create --module billing-service")
   Tool call: bash("dx sandbox exec sbx_xxx -- npm test")
   Result: "3 tests failing in billing.test.ts"
   Tool call: grep("billing.test.ts", "describe|it\\(")
   Tool call: read_file("src/billing.ts")
   ... investigates ...
   Tool call: ask_user("Found the issue: the Stripe API version was updated but the response parser wasn't. There are 3 files to fix. This will take a few minutes. Should I proceed?")
5. User: "yes go ahead"
6. AI turn 2:
   ... makes fixes across 3 files ...
   ... runs tests ...
   Tool call: bash("npm test")
   Result: "All 47 tests passing"
   Tool call: bash("dx pr create --title 'fix: update Stripe response parser for API v3'")
   ... etc.
```

---

## 11. Implementation Steps

### Step 1: Scaffold Next.js app
- Create `agent-chat/` in monorepo
- Install dependencies: `chat`, `@chat-adapter/slack`, `@vercel/workflow`, `ai`, `@ai-sdk/anthropic`
- Configure `next.config.ts`, environment variables
- Add to `pnpm-workspace.yaml`

### Step 2: Chat SDK setup + webhook route
- Create `bot.ts` with Chat instance + Slack adapter
- Create webhook API route (`/api/webhooks/[platform]/route.ts`)
- Wire up `onNewMention`, `onSubscribedMessage`, `onAction` handlers

### Step 3: Custom state adapter
- Implement `factory-state-adapter.ts`
- Map Chat SDK state operations to Factory API calls
- Add Redis for distributed locks

### Step 4: Factory API client
- Create `factory-client.ts` with typed methods for all needed endpoints
- Add any missing Factory API endpoints (e.g., resolve user by external ID)

### Step 5: Durable conversation workflow
- Create `conversation.ts` workflow
- Implement steps: `resolve-context`, `ai-turn`, `wait-for-user`
- Wire up workflow start/resume in bot event handlers

### Step 6: Tool definitions
- Implement all tools: `bash`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `ask_user`, `web_fetch`
- `bash` tool: lightweight mode (dx CLI in process) vs sandbox mode (exec in sandbox)
- `ask_user` tool: post to Slack, pause workflow, resume on response

### Step 7: Context builder
- Implement `context-builder.ts`
- Fetch memories from Factory API (org + team layers)
- Build structured system prompt with agent identity, memories, channel context, user context

### Step 8: Execution mode logic
- Implement `execution-mode.ts`
- Detect when sandbox is needed (code changes) vs lightweight (CLI operations)
- Handle sandbox creation and tool routing

### Step 9: Sandbox integration
- Wire up sandbox creation/exec/cleanup via Factory API
- Handle sandbox lifecycle within the workflow (create → exec → PR → cleanup)

### Step 10: End-to-end testing
- Test with real Slack workspace (ngrok/cloudflared for local dev)
- Test: mention → lightweight response
- Test: mention → sandbox → PR flow
- Test: multi-turn conversation with ask_user
- Test: workflow durability (restart mid-conversation)

---

## 12. Dependencies

| Package | Purpose |
|---------|---------|
| `chat` | Chat SDK core |
| `@chat-adapter/slack` | Slack platform adapter |
| `@vercel/workflow` | Durable workflow execution |
| `ai` | Vercel AI SDK |
| `@ai-sdk/anthropic` | Claude model provider |
| `ioredis` | Redis client for distributed locks |

---

## 13. Follow-up Deliverables

1. **Agent Skill** — System prompt + tool configuration that teaches the agent how to use `dx` CLI, when to use sandboxes, coding conventions, etc. This is the "brain" of the agent.
2. **Web UI Transport** — Same backend, but served via HTTP streaming to a React `useChat()` client instead of Slack.
3. **Event-triggered workflows** — PR opened → auto-review, test failure → auto-diagnose, deploy failure → auto-investigate. These use the same Workflow infrastructure but with different triggers (webhooks instead of @mentions).
4. **Multi-agent collaboration** — Supervisor agent delegates to specialist agents. Uses the job `parentJobId`/`delegatedByAgentId` fields already in the schema.
