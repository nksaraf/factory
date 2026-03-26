# Product Requirements Document

# **Agent Plane (Factory-Scoped Automation and AI Agent Infrastructure)**

---

**Document Owner:** Nikhil
**Version:** 0.1 (Draft)
**Last Updated:** March 2026
**Status:** RFC — Request for Comments

---

## 1. Executive Summary

The Agent Plane is the Factory-wide infrastructure for designing, registering, executing, and governing AI agents that automate work across every other Factory plane. It is the company's internal automation operating system — the layer that transforms a human-driven software factory into an increasingly autonomous one.

Agents are not assistants. They are autonomous workers with their own identities, permissions, memory, tools, and execution histories. They write code, generate tests, triage backlogs, scan for vulnerabilities, deploy releases, monitor infrastructure, and respond to incidents. They operate across Product Plane, Build Plane, Fleet Plane, Commerce Plane, and Infrastructure Plane — but are governed centrally by Agent Plane.

Agent Plane is **Factory-scoped only**. Customer-facing AI capabilities (e.g., SmartMarket's AI Analyst) are Service Plane modules that may eventually consume shared Agent Plane primitives (memory, execution tracking, tool registry) but are architecturally distinct constructs with their own lifecycle. This PRD does not cover application-level agents.

The long-term trajectory is an **automated software factory** — a system where agents handle the majority of routine engineering, QA, product, security, and operations work, with humans providing strategic direction, reviewing high-impact decisions, and handling novel problems that exceed agent capabilities.

---

## 2. Problem Statement

The company is building multiple enterprise products (Trafficure, NetworkAccess, SmartMarket) across regulated verticals. Each product requires engineering, QA, product management, security, and operational work that grows linearly with customer count and feature surface area. Without centralized automation infrastructure:

- Engineering agents are built ad-hoc per team with no shared identity, audit trail, or cost tracking.
- QA automation is script-based and brittle — no adaptive test generation, no regression detection beyond hardcoded assertions.
- Product work (backlog grooming, spec drafting, release notes) remains entirely manual despite being highly structured and pattern-driven.
- Security scanning runs on schedule rather than continuously, and findings require manual triage that delays remediation.
- Operations response is reactive — incidents are detected by alerts, triaged by humans, and resolved through manual runbooks.
- There is no way to track what automation costs, what ROI it delivers, or whether agent outputs are degrading over time.
- Agent permissions are granted ad-hoc with no central governance, creating security risk as agents access more systems.

Agent Plane solves this by establishing a single, governed infrastructure that all agents run on, regardless of which plane they operate in.

---

## 3. Design Principles

1. **Agents are principals, not tools.** Every agent has a first-class identity in the system — authenticated, authorized, auditable. An agent is never "a script running as a user."
2. **Separation of orchestration from execution.** The orchestration layer (task routing, agent coordination, state management) is decoupled from the execution layer (LLM calls, tool invocations, code generation). Orchestrators can be swapped. Executors can be swapped.
3. **Model-agnostic by design.** The platform abstracts LLM providers behind a unified model registry. Agents declare capability requirements; the platform resolves them to available models. This supports multi-provider strategies and air-gapped deployments with local models.
4. **Memory is structured and scoped.** Agent memory is not a flat context window dump. It is layered: ephemeral (within execution), short-term (within task), long-term (persistent knowledge), and shared (cross-agent knowledge graphs).
5. **Every action is auditable.** Every tool call, every LLM invocation, every decision, every output is recorded. The audit trail is not optional — it is the foundation for trust, debugging, cost tracking, and compliance.
6. **Human-in-the-loop is a policy, not a feature.** The system supports a spectrum from fully autonomous to fully supervised. The approval model is configurable per agent type, per action category, per risk level — not hardcoded.
7. **Cost is a first-class constraint.** LLM calls cost money. Agent executions consume compute. The system tracks, budgets, and enforces cost limits per agent, per team, per plane.
8. **Protocols over custom integrations.** Agent-to-tool connections use MCP. Agent-to-agent coordination uses A2A. Standard protocols enable interoperability, reduce integration cost, and prevent vendor lock-in.
9. **Graceful degradation.** If the LLM provider is unavailable, agents queue work rather than fail. If an agent produces low-confidence output, it escalates rather than ships. The system is designed for partial failure.
10. **Factory-scoped, not Site-scoped.** Agent Plane runs once, centrally. It does not run inside customer Sites. Application-level AI is a separate architectural concern.

---

## 4. Core Concepts

### 4.1 Agent

An autonomous software entity registered in the Agent Plane with its own identity, capabilities, permissions, and lifecycle.

An agent is defined by:

- **Identity** — a first-class principal in the system (not a user impersonation)
- **Type** — engineering, QA, product, security, operations, or custom
- **Capabilities** — declared skills (e.g., "can generate Python code," "can run Terraform plans")
- **Tool grants** — which MCP tools the agent is authorized to use
- **Model requirements** — what LLM capabilities the agent needs (reasoning, code generation, vision, etc.)
- **Autonomy level** — fully autonomous, supervised, or approval-required per action category
- **Memory scope** — what persistent knowledge the agent maintains

Agents are versioned. A new version of an agent's prompts, tools, or model requirements creates a new agent version, tracked in the registry.

---

### 4.2 Agent Type

A classification that determines default capabilities, permissions, governance policies, and cost controls.

**Engineering Agent** — operates in Build Plane. Writes code, reviews PRs, refactors modules, generates documentation. Has access to repositories, CI pipelines, and artifact registries.

**QA Agent** — operates across Build Plane and Service Plane boundaries. Generates tests, executes test suites, detects regressions, validates deployments. Has access to test infrastructure, coverage reports, and deployment environments.

**Product Agent** — operates in Product Plane. Grooms backlogs, drafts specs, generates release notes, analyzes delivery metrics, triages defects. Has access to work graphs, roadmaps, and analytics.

**Security Agent** — operates across Build Plane and Infrastructure Plane. Scans dependencies, detects vulnerabilities, checks compliance, reviews security configurations. Has access to SBOMs, vulnerability databases, and infrastructure state.

**Operations Agent** — operates across Fleet Plane and Infrastructure Plane. Monitors health, responds to incidents, executes runbooks, scales infrastructure, manages rollouts. Has access to monitoring systems, fleet state, and infrastructure controls.

Custom agent types can be registered for specialized automation that doesn't fit these categories.

---

### 4.3 Agent Execution

A single invocation of an agent to perform a task. An execution has a lifecycle:

```
QUEUED → PLANNING → EXECUTING → AWAITING_APPROVAL → COMPLETING → COMPLETED
                                                                → FAILED
                                                                → CANCELLED
                                                                → ESCALATED
```

Each execution contains one or more **execution steps** — individual tool calls, LLM invocations, or sub-agent delegations. Steps are the atomic unit of audit and cost tracking.

Executions are durable. If the system crashes mid-execution, it resumes from the last committed step (Temporal workflow semantics).

---

### 4.4 Agent Task

A unit of work assigned to an agent. Tasks can originate from:

- **Human assignment** — an engineer assigns a task to an agent via Product Plane
- **Event trigger** — a system event (PR created, build failed, alert fired) triggers an agent task
- **Scheduled trigger** — a cron-like schedule triggers periodic agent work
- **Agent delegation** — one agent delegates a sub-task to another agent via A2A
- **Escalation** — a failed or uncertain execution escalates to a different agent or human

Tasks have priority, deadlines, and retry policies. A task may produce multiple executions (retries, re-runs).

---

### 4.5 Agent Memory

Persistent knowledge that agents accumulate and use across executions. Memory is layered:

**Ephemeral Memory** — exists only within a single execution. The LLM context window, intermediate reasoning, scratch computations. Discarded after execution completes.

**Task Memory** — persists across execution retries within a single task. Contains task-specific context, partial results, and decisions made. Discarded when the task completes.

**Agent Memory** — persists across all executions of a specific agent. Contains learned patterns, preferences, and domain knowledge specific to that agent's role. Examples: a code review agent's understanding of the team's coding standards; an operations agent's knowledge of which runbooks work for which failure modes.

**Shared Memory** — persists across agents. A knowledge graph of entities, relationships, and facts about the codebase, infrastructure, products, and organization. Examples: module dependency graphs, service ownership maps, deployment topology, incident history.

Memory is stored as a **hybrid** of vector embeddings (for semantic retrieval) and structured knowledge graphs (for entity relationships and reasoning). Vector search answers "what is relevant to this context?" Knowledge graphs answer "what is related to this entity and how?"

---

### 4.6 Tool

An external capability that an agent can invoke. Tools are registered in the **Tool Registry** and exposed to agents via **MCP (Model Context Protocol)**.

Tools include:

- Factory Plane APIs (Product, Build, Fleet, Commerce, Infrastructure)
- External services (GitHub, Jira, Slack, PagerDuty)
- Databases and data stores
- CLI tools and scripts
- Other agents (via A2A protocol)

Each tool has:

- **MCP server definition** — how to connect and invoke
- **Schema** — input/output types
- **Permission requirements** — what scopes are needed
- **Rate limits** — how frequently it can be called
- **Cost** — per-invocation cost (if applicable)

---

### 4.7 Model Registry

A catalog of available LLM models that agents can use. The model registry abstracts provider-specific details behind a capability-based interface.

Each model entry includes:

- **Provider** — Anthropic, OpenAI, local (Ollama/vLLM), custom
- **Capabilities** — reasoning, code generation, vision, tool use, long context, structured output
- **Context window** — maximum token capacity
- **Cost** — per-token pricing (input/output)
- **Latency profile** — expected response times
- **Availability** — which deployment environments can reach this model
- **Compliance tags** — data residency, air-gapped compatible, SOC2 compliant

Agents declare capability requirements. The model router resolves requirements to the best available model, considering capability, cost, latency, and availability constraints.

For air-gapped deployments, the model registry includes locally hosted models (Llama, Mistral, or fine-tuned variants) that run on-premise. The abstraction ensures agent code does not change between cloud and air-gapped environments — only the model resolution changes.

---

## 5. Architecture

### 5.1 Component Architecture

```
Agent Plane

┌─────────────────────────────────────────────────────────────────┐
│                        Agent Gateway                            │
│    (API surface, task submission, status queries, WebSocket)     │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────┐
│                     Orchestration Layer                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Task Router   │  │ Agent        │  │ Human-in-the-Loop  │    │
│  │               │  │ Coordinator  │  │ Approval Engine    │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Event         │  │ Schedule     │  │ Escalation         │    │
│  │ Listener      │  │ Engine       │  │ Manager            │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────┐
│                      Execution Layer                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │              Temporal Workflow Engine                    │     │
│  │  (durable execution, retries, saga, state persistence)  │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Model Router  │  │ MCP Client   │  │ A2A Client /       │    │
│  │ (LLM calls)   │  │ (tool calls)  │  │ Server (delegation)│    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────┐
│                      Persistence Layer                           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Agent         │  │ Memory Store  │  │ Audit Store        │    │
│  │ Registry DB   │  │ (Vector +     │  │ (execution logs,   │    │
│  │               │  │  Graph)       │  │  cost records)     │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

### 5.2 Protocol Architecture — MCP + A2A

Agent Plane adopts a **layered protocol strategy** aligned with the emerging industry consensus:

**MCP (Model Context Protocol)** — the agent-to-tool layer. Every external system that agents interact with is exposed as an MCP server. This includes Factory Plane APIs, source control, CI/CD, monitoring, databases, and any third-party service. MCP provides standardized tool discovery, invocation, and context preservation.

**A2A (Agent-to-Agent Protocol)** — the agent-to-agent layer. When one agent needs to delegate work to another agent, coordinate a multi-agent workflow, or discover which agent has the right capabilities, it uses A2A. A2A provides agent discovery (via Agent Cards), task delegation, lifecycle tracking, and streaming results.

**Why both:** MCP answers "how does an agent use a tool?" A2A answers "how do agents work together?" These are complementary concerns. Using MCP alone forces all inter-agent communication through shared tools (clumsy). Using A2A alone forces tool integration through agent wrappers (wasteful). The layered approach keeps each protocol focused on what it does best.

**Protocol selection rule:**

| Interaction                | Protocol                | Example                                                 |
| -------------------------- | ----------------------- | ------------------------------------------------------- |
| Agent → external tool      | MCP                     | Agent calls GitHub API to create PR                     |
| Agent → Factory Plane API  | MCP                     | Agent queries Fleet Plane for site health               |
| Agent → Agent (delegation) | A2A                     | Code agent delegates test generation to QA agent        |
| Agent → Agent (discovery)  | A2A                     | Orchestrator discovers which agent can handle Terraform |
| Agent → LLM                | Model Router (internal) | Agent sends prompt to Claude / Llama                    |
| Human → Agent (task)       | Agent Gateway (REST/WS) | Engineer submits code review task                       |

**Agent Cards:** Every agent publishes an A2A-compliant Agent Card — a JSON manifest describing its identity, capabilities, supported interaction modes, and authentication requirements. Agent Cards are served from the Agent Registry and enable dynamic discovery.

```json
{
  "name": "engineering-code-review",
  "version": "2.1.0",
  "description": "Reviews pull requests for code quality, security, and consistency",
  "protocolVersion": "1.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "review_pull_request",
      "description": "Reviews a PR and provides structured feedback",
      "inputSchema": {
        "type": "object",
        "properties": { "pr_url": { "type": "string" } }
      }
    },
    {
      "id": "suggest_refactor",
      "description": "Suggests refactoring for a code block"
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

---

### 5.3 Execution Model — Temporal Workflows

Every agent execution is a **Temporal workflow**. This provides:

- **Durability** — if the worker crashes mid-execution, the workflow resumes from the last committed step. No work is lost.
- **Retries with backoff** — failed LLM calls or tool invocations are automatically retried with configurable policies.
- **Saga pattern** — multi-step executions that need rollback on failure (e.g., "created PR but tests failed, so close PR") are modeled as compensating transactions.
- **Timeouts** — executions that exceed time budgets are automatically cancelled or escalated.
- **Visibility** — Temporal provides built-in execution history, making debugging and audit trivial.
- **Idempotency** — each step has an idempotency key, preventing duplicate work on replay.

**Workflow structure:**

```
AgentExecutionWorkflow
├── PlanningActivity        (agent reasons about the task, creates execution plan)
├── ApprovalActivity        (if policy requires human approval, pause and wait)
├── ExecutionActivity[]     (sequence of tool calls and LLM invocations)
│   ├── ToolCallActivity    (MCP call to external tool)
│   ├── LLMCallActivity     (model router call to LLM)
│   ├── DelegationActivity  (A2A call to another agent)
│   └── MemoryActivity      (read/write agent memory)
├── ValidationActivity      (verify outputs meet quality criteria)
└── CompletionActivity      (record results, update memory, emit events)
```

**Concurrency:** Multiple agent executions run in parallel. Temporal workers scale horizontally. The system supports 100+ concurrent executions per agent type.

---

### 5.4 Identity and Authentication

**Recommendation: Agent-specific identity type (first-class principal) with service account mechanics.**

Agents are registered as principals in the Factory's identity system — not as users, and not as generic service accounts. They are a distinct principal type: `agent_identity`.

This matters because:

- **Audit clarity** — when reviewing logs, "agent:engineering-code-review-v2.1" is immediately distinguishable from "user:nikhil" or "sa:ci-pipeline."
- **Permission scoping** — agent permissions can be managed separately from user permissions and service account permissions. An agent's tool grants are distinct from what a CI pipeline can do.
- **Lifecycle management** — agents have their own lifecycle (registered, active, deprecated, retired) that doesn't map to user or service account lifecycles.

**Authentication flow:**

1. Agent is registered in Agent Registry → receives `agent_id` and identity record
2. Agent Plane issues short-lived, scoped JWT tokens for each execution
3. Token contains: `agent_id`, `agent_version`, `execution_id`, `granted_tools[]`, `granted_scopes[]`
4. External systems (MCP servers, Factory APIs) validate the token and enforce scope
5. Token expires when the execution completes or times out

**Key properties:**

- Tokens are execution-scoped (not agent-scoped) — a compromised token from one execution cannot be used in another
- Tokens carry explicit tool and scope grants — principle of least privilege per execution
- All token issuance and validation is audited

---

### 5.5 Memory Architecture

**Recommendation: Hybrid vector + knowledge graph.**

| Memory Layer | Storage                                      | Retrieval                   | TTL                     | Example                                                    |
| ------------ | -------------------------------------------- | --------------------------- | ----------------------- | ---------------------------------------------------------- |
| Ephemeral    | In-process (Temporal workflow state)         | Direct access               | Execution lifetime      | LLM reasoning chain, intermediate outputs                  |
| Task         | Temporal workflow variables                  | Direct access               | Task lifetime           | Partial code review results across retries                 |
| Agent        | Vector DB (pgvector or Qdrant)               | Semantic search             | Indefinite (with decay) | Code review patterns, team conventions learned             |
| Shared       | Knowledge graph (PostgreSQL + graph queries) | Entity traversal + semantic | Indefinite              | Module dependency map, service ownership, incident history |

**Why hybrid:**

Vector embeddings excel at semantic retrieval — "find me context relevant to this code review" — but they lack structure. You can't traverse relationships or answer "which services depend on module X?"

Knowledge graphs excel at structured reasoning — "what is the deployment topology of this service?" — but they require explicit schema and maintenance.

The hybrid approach uses each for what it does best:

- **Vector store** handles: unstructured context retrieval, similarity search across agent memory, finding relevant past executions
- **Knowledge graph** handles: entity relationships (module → service → owner → team), dependency chains, causal reasoning ("this incident was caused by this deployment which included this PR")

**Memory write policy:**

Not every execution produces valuable memory. The system uses a **memory curator** — a lightweight classifier that evaluates execution outputs and decides:

- Should this be stored in agent memory? (pattern learned, convention identified)
- Should this update shared memory? (new entity relationship, topology change)
- Should this be discarded? (routine execution, no new knowledge)

This prevents memory bloat and ensures stored knowledge remains high-signal.

---

## 6. Functional Requirements

### 6.1 Agent Registry

The system of record for all agents.

**Registration:**

- Register new agent with type, capabilities, tool requirements, model requirements, and autonomy level
- Version agents — new prompt templates, tool grants, or model changes create a new version
- Deprecate and retire agents with graceful migration

**Discovery:**

- Query registry by capability ("which agents can review Go code?")
- Query registry by type ("list all security agents")
- A2A Agent Card publication for inter-agent discovery
- Health and availability status per agent

**Lifecycle states:**

```
REGISTERED → ACTIVE → DEPRECATED → RETIRED
                   → SUSPENDED (manual or policy-triggered)
```

---

### 6.2 Task Management

**Task creation:**

- Submit tasks via API (human-initiated)
- Auto-create tasks from event triggers (PR created, build failed, alert fired, schedule tick)
- Accept delegated tasks from other agents via A2A

**Task routing:**

- Route to the best available agent based on capability match, current load, and priority
- Support affinity — prefer routing to the same agent that handled related prior tasks (context reuse)
- Support load balancing — distribute across agent workers when no affinity benefit exists

**Task lifecycle:**

```
PENDING → ASSIGNED → IN_PROGRESS → AWAITING_REVIEW → COMPLETED
                                                    → FAILED
                                                    → ESCALATED
                                                    → CANCELLED
```

**Priority and scheduling:**

- Priority levels: critical, high, normal, low, background
- SLA-based deadlines with escalation on breach
- Batch scheduling for bulk operations (e.g., "review all open PRs")
- Rate limiting to prevent agent storms

---

### 6.3 Execution Engine

**Workflow execution:**

- Execute agent tasks as Temporal workflows
- Support multi-step plans with conditional branching
- Support parallel step execution where steps are independent
- Enforce execution timeouts per step and per workflow
- Emit execution events for real-time monitoring

**Retry and recovery:**

- Configurable retry policies per step type (LLM calls: 3 retries with exponential backoff; tool calls: 2 retries)
- Saga-pattern compensation for multi-step failures
- Dead letter queue for tasks that exhaust retries
- Manual replay from any step (for debugging)

**Execution recording:**

Every execution produces a full record:

```
execution_record
├── execution_id
├── agent_id, agent_version
├── task_id
├── status
├── started_at, completed_at
├── total_cost
├── steps[]
│   ├── step_id
│   ├── step_type (llm_call, tool_call, delegation, memory_op)
│   ├── input (redacted if sensitive)
│   ├── output (redacted if sensitive)
│   ├── model_used (if LLM)
│   ├── tool_used (if tool)
│   ├── delegated_to (if delegation)
│   ├── tokens_in, tokens_out (if LLM)
│   ├── cost
│   ├── latency_ms
│   └── status
├── memory_writes[]
└── approval_records[]
```

---

### 6.4 Model Router

**Model resolution:**

- Agent declares required capabilities (e.g., "code generation," "long context," "tool use")
- Router resolves to best available model considering: capability match → cost → latency → availability
- Support fallback chains: primary model unavailable → secondary → tertiary
- Support model pinning for reproducibility (agent version X always uses model Y)

**Provider abstraction:**

- Unified API interface across providers (Anthropic, OpenAI, local)
- Prompt format normalization (system/user/assistant, tool definitions)
- Response format normalization (text, tool calls, structured output)
- Streaming support

**Air-gapped support:**

- Local model hosting via Ollama, vLLM, or TGI
- Model registry includes locally available models with their capabilities
- No code changes required — only model resolution differs
- Graceful degradation: if local model lacks capability (e.g., vision), task is queued or escalated

**Cost tracking per call:**

- Input tokens, output tokens, cached tokens
- Per-call cost calculated from model pricing
- Aggregated per execution, per agent, per team, per plane

---

### 6.5 Tool Registry and MCP

**Tool registration:**

- Register MCP server definitions (URL, transport, authentication)
- Define tool schemas (input/output types)
- Tag tools by category (source control, CI, monitoring, database, etc.)
- Set rate limits and cost per invocation

**Tool authorization:**

- Tool grants are per-agent, per-version
- Grants specify allowed tools and allowed operations (read-only, read-write, admin)
- Grants are included in execution tokens — MCP servers can verify authorization
- Changes to tool grants require approval and create audit records

**Built-in MCP servers (Phase 1):**

| MCP Server             | Tools Exposed                                                 | Used By                |
| ---------------------- | ------------------------------------------------------------- | ---------------------- |
| `factory-build-mcp`    | create_pr, merge_pr, run_ci, get_build_status                 | Engineering, QA agents |
| `factory-product-mcp`  | create_task, update_story, query_backlog, draft_release_notes | Product agents         |
| `factory-fleet-mcp`    | get_site_health, trigger_rollout, get_deployment_status       | Operations agents      |
| `factory-infra-mcp`    | get_cluster_status, scale_nodes, get_alerts                   | Operations agents      |
| `factory-commerce-mcp` | get_entitlements, get_usage_metrics                           | Product agents         |
| `source-control-mcp`   | read_file, write_file, list_branches, diff_commits            | Engineering agents     |
| `security-scanner-mcp` | scan_dependencies, get_vulnerabilities, check_compliance      | Security agents        |

---

### 6.6 Agent Coordination (Multi-Agent Workflows)

**Delegation:**

- An orchestrator agent can delegate sub-tasks to specialist agents via A2A
- Delegation creates a child task with its own execution lifecycle
- Parent execution blocks on child completion (or continues async with callback)
- Delegation depth is bounded (configurable, default: 3 levels) to prevent runaway chains

**Multi-agent patterns:**

**Sequential pipeline:** Output of agent A feeds into agent B.

```
Code Agent (generate code)
  → QA Agent (generate tests)
    → Security Agent (scan for vulnerabilities)
      → Code Agent (fix findings)
```

**Parallel fan-out:** Multiple agents work on independent sub-tasks simultaneously.

```
Orchestrator assigns:
  ├── Code Agent A (frontend changes)
  ├── Code Agent B (backend changes)
  └── Code Agent C (migration script)
Orchestrator aggregates results → creates unified PR
```

**Collaborative review:** Multiple agents review the same artifact from different perspectives.

```
PR submitted:
  ├── Code Quality Agent (style, patterns, complexity)
  ├── Security Agent (vulnerabilities, secrets, access patterns)
  └── Architecture Agent (API design, module boundaries)
Results merged → unified review comment
```

**Conflict resolution:** When agents produce conflicting recommendations, the system:

1. Attempts automatic resolution using priority rules (security > performance > style)
2. Escalates to a senior orchestrator agent if rules are insufficient
3. Escalates to a human if the orchestrator cannot resolve

---

### 6.7 Human-in-the-Loop

**Approval policies:**

Approval requirements are configurable per:

- Agent type
- Action category (code merge, deployment, infrastructure change, data modification)
- Risk level (low, medium, high, critical)
- Target system (production vs. staging)

**Default approval matrix:**

| Action Category              | Risk Level | Default Policy                            |
| ---------------------------- | ---------- | ----------------------------------------- |
| Code review comment          | Low        | Autonomous                                |
| Test generation              | Low        | Autonomous                                |
| Backlog grooming             | Low        | Autonomous                                |
| PR creation (non-production) | Medium     | Autonomous with notification              |
| PR merge (production)        | High       | Requires human approval                   |
| Deployment trigger           | High       | Requires human approval                   |
| Infrastructure scaling       | Medium     | Autonomous within bounds, approval beyond |
| Security fix (critical CVE)  | Critical   | Autonomous creation, approval to merge    |
| Incident response (runbook)  | High       | Autonomous with immediate notification    |
| Data migration               | Critical   | Requires human approval                   |

**Approval flow:**

1. Execution reaches an action requiring approval
2. Temporal workflow pauses (durable — survives system restarts)
3. Notification sent to designated approver(s) via configured channel (Slack, email, dashboard)
4. Approver reviews context (agent's plan, relevant code, risk assessment)
5. Approver approves, rejects, or requests modification
6. Execution resumes or terminates based on decision
7. Approval decision is recorded in audit trail

**Approval timeout:** If no approval is received within the configured window (default: 4 hours for high, 1 hour for critical), the system escalates to backup approvers or cancels the task.

---

### 6.8 Cost Management

**Cost tracking:**

- Per-execution cost (sum of all LLM calls + tool calls)
- Per-agent cost (rolling daily, weekly, monthly)
- Per-team cost (aggregated by owning team)
- Per-plane cost (how much automation costs in Build vs. Product vs. Fleet)

**Budget enforcement:**

- Per-agent daily budget cap (hard limit — execution paused if exceeded)
- Per-team monthly budget (soft limit with alerts, hard limit optional)
- Per-execution cost ceiling (kill execution if projected cost exceeds threshold)

**Cost optimization:**

- Model router prefers cheaper models when capability requirements allow
- Prompt caching for repeated tool/context patterns
- Batched LLM calls where possible (e.g., reviewing 5 files in one call vs. 5 separate calls)
- Cost-per-output tracking to identify agents with degrading cost efficiency

**Reporting:**

- Daily cost digest per team
- Weekly cost trends and anomaly detection
- ROI estimation: cost of agent execution vs. estimated human time saved

---

### 6.9 Observability and Quality

**Performance metrics:**

- Execution success rate per agent
- Mean execution time per task type
- LLM call latency (p50, p95, p99)
- Tool call latency
- Queue depth and wait time

**Quality metrics:**

- Agent output acceptance rate (did the human accept the agent's work?)
- Revision rate (how often was agent output modified before use?)
- Regression detection (is agent quality degrading over time?)
- Hallucination detection (for agents producing code: does it compile? do tests pass?)

**Drift detection:**

- Track quality metrics over time per agent version
- Alert when acceptance rate drops below threshold
- Alert when cost-per-output increases above threshold
- Trigger automatic evaluation suite when drift is detected

**Dashboards:**

- Agent Fleet Dashboard — health, load, cost, quality across all agents
- Agent Detail Dashboard — execution history, quality trends, cost for a specific agent
- Team Dashboard — automation coverage, cost, ROI per team
- Execution Inspector — step-by-step view of any execution for debugging

---

### 6.10 Security and Governance

**Principle of least privilege:**

- Each agent version has explicit tool grants — no implicit access
- Grants are reviewed and approved by designated owners
- Grants expire and must be renewed (configurable, default: 90 days)

**Blast radius containment:**

- Per-agent execution sandboxing (Temporal task queues isolate agent types)
- Per-agent rate limits on tool calls
- Per-agent concurrent execution limits
- Kill switch — instantly suspend all executions of a specific agent

**Secret management:**

- Agents never see raw secrets — secrets are injected by the execution runtime into tool calls
- Secrets are scoped to specific tools and agents
- Secret rotation does not require agent changes

**Compliance:**

- Full audit trail of every action, decision, and output
- Execution records are immutable and retained per policy
- Agent permission changes require approval workflow
- Regular automated audits of agent permissions vs. actual usage (flag unused grants)

---

## 7. Agent Types — Detailed Specifications

### 7.1 Engineering Agents

**Code Generation Agent**

- Receives task descriptions or story specifications
- Generates implementation code following project conventions
- Creates PRs with descriptions, test stubs, and documentation
- Learns team patterns from accepted code reviews (agent memory)

**Code Review Agent**

- Triggered on PR creation
- Reviews for: correctness, security, performance, style, test coverage
- Provides structured inline comments with severity levels
- Learns review preferences from human overrides

**Refactoring Agent**

- Identifies code that benefits from refactoring (complexity, duplication, pattern violations)
- Proposes refactoring PRs with before/after comparisons
- Validates refactoring doesn't change behavior (runs tests)

**Documentation Agent**

- Generates and updates API documentation from code
- Creates module README files
- Drafts architecture decision records (ADRs)
- Maintains changelog entries from merged PRs

---

### 7.2 QA Agents

**Test Generation Agent**

- Analyzes code changes and generates unit tests, integration tests, and edge case tests
- Targets uncovered code paths (integrates with coverage reports)
- Generates property-based tests for complex logic

**Regression Detection Agent**

- Monitors test suite results across builds
- Identifies flaky tests and quarantines them
- Detects performance regressions by comparing benchmark results

**Deployment Validation Agent**

- Runs smoke tests against deployed environments
- Validates API contract compliance
- Checks for configuration drift between environments

---

### 7.3 Product Agents

**Backlog Grooming Agent**

- Reviews and enriches story descriptions (adds acceptance criteria, edge cases)
- Identifies duplicate or overlapping stories
- Suggests priority based on dependency analysis and delivery velocity

**Spec Drafting Agent**

- Generates initial technical spec from product requirements
- Identifies dependencies, risks, and open questions
- Formats output per team's spec template

**Release Notes Agent**

- Compiles merged PRs since last release
- Categorizes changes (features, fixes, improvements, breaking changes)
- Generates customer-facing release notes and internal changelog

**Delivery Analytics Agent**

- Tracks velocity, cycle time, and throughput per team
- Identifies bottlenecks (stories stuck in review, blocked dependencies)
- Generates weekly delivery reports

---

### 7.4 Security Agents

**Dependency Scanner Agent**

- Continuously scans dependencies for known vulnerabilities
- Prioritizes findings by severity and exploitability
- Auto-creates remediation PRs for patch-level updates
- Escalates breaking-change updates for human review

**Compliance Checker Agent**

- Validates configurations against compliance frameworks (SOC2, ISO 27001, GDPR)
- Checks infrastructure-as-code for security misconfigurations
- Generates compliance reports

**Secret Detection Agent**

- Scans PRs and commits for accidentally committed secrets
- Blocks merges containing secrets
- Integrates with secret rotation workflows

---

### 7.5 Operations Agents

**Incident Response Agent**

- Triggered by monitoring alerts
- Correlates alert with recent deployments, configuration changes, and known issues
- Executes diagnostic runbooks (collect logs, check service health, test connectivity)
- Proposes remediation or auto-remediates for known patterns
- Creates incident records with timeline and root cause analysis

**Health Monitor Agent**

- Continuously monitors fleet health across all sites
- Detects anomalies in resource utilization, error rates, and latency
- Proactively alerts before thresholds are breached (predictive)

**Rollout Agent**

- Coordinates deployment rollouts across fleet
- Monitors deployment health during rollout
- Auto-rolls back on error rate increase
- Generates deployment reports

**Capacity Planning Agent**

- Analyzes resource utilization trends
- Projects future capacity needs based on customer growth and usage patterns
- Recommends scaling actions with cost estimates

---

## 8. Data Model

### 8.1 Core Entities

```
agent
├── agent_id (PK)
├── name
├── agent_type
├── owner_team
├── lifecycle_state
├── current_version_id (FK)
├── created_at
└── updated_at

agent_version
├── agent_version_id (PK)
├── agent_id (FK)
├── version
├── prompt_template_hash
├── model_requirements (JSONB)
├── tool_grants (JSONB)
├── autonomy_config (JSONB)
├── created_at
└── created_by

agent_task
├── task_id (PK)
├── agent_id (FK, nullable — assigned after routing)
├── parent_task_id (FK, nullable — for delegated tasks)
├── source_type (human, event, schedule, delegation)
├── source_ref (event_id, schedule_id, parent_execution_id)
├── priority
├── deadline
├── status
├── retry_policy (JSONB)
├── created_at
└── updated_at

agent_execution
├── execution_id (PK)
├── task_id (FK)
├── agent_id (FK)
├── agent_version_id (FK)
├── workflow_run_id (Temporal workflow ID)
├── status
├── plan (JSONB — the execution plan the agent created)
├── result (JSONB — final output)
├── total_cost
├── total_tokens_in
├── total_tokens_out
├── started_at
├── completed_at
└── error (text, nullable)

agent_execution_step
├── step_id (PK)
├── execution_id (FK)
├── step_order
├── step_type (llm_call, tool_call, delegation, memory_read, memory_write)
├── input (JSONB, redacted)
├── output (JSONB, redacted)
├── model_used (nullable)
├── tool_used (nullable)
├── delegated_to_agent_id (nullable)
├── tokens_in (nullable)
├── tokens_out (nullable)
├── cost
├── latency_ms
├── status
├── idempotency_key
└── created_at

agent_approval
├── approval_id (PK)
├── execution_id (FK)
├── step_id (FK)
├── action_category
├── risk_level
├── approver_id (FK → principal)
├── decision (approved, rejected, modified)
├── reason (text, nullable)
├── requested_at
└── decided_at

agent_tool_grant
├── grant_id (PK)
├── agent_version_id (FK)
├── tool_id
├── operations_allowed (JSONB)
├── expires_at
├── granted_by (FK → principal)
└── created_at

model_registry_entry
├── model_id (PK)
├── provider
├── model_name
├── capabilities (JSONB)
├── context_window
├── cost_per_input_token
├── cost_per_output_token
├── latency_profile (JSONB)
├── availability_tags (JSONB)
├── compliance_tags (JSONB)
├── active
└── updated_at

agent_memory_item
├── memory_id (PK)
├── agent_id (FK, nullable — null for shared memory)
├── memory_type (agent, shared)
├── content (text)
├── embedding (vector)
├── metadata (JSONB — entities, tags, source execution)
├── relevance_score (float — decays over time)
├── created_at
└── last_accessed_at

agent_event_trigger
├── trigger_id (PK)
├── agent_id (FK)
├── event_type
├── event_source (plane, service)
├── filter_conditions (JSONB)
├── task_template (JSONB)
├── active
└── created_at

agent_schedule
├── schedule_id (PK)
├── agent_id (FK)
├── cron_expression
├── task_template (JSONB)
├── active
├── last_triggered_at
└── created_at

agent_cost_record
├── record_id (PK)
├── agent_id (FK)
├── agent_version_id (FK)
├── execution_id (FK)
├── model_used
├── tokens_in
├── tokens_out
├── cost
├── recorded_at
└── team_id

agent_quality_metric
├── metric_id (PK)
├── agent_id (FK)
├── agent_version_id (FK)
├── metric_type (acceptance_rate, revision_rate, success_rate, cost_per_output)
├── value (float)
├── period_start
├── period_end
└── calculated_at
```

---

### 8.2 Key Relationships

```
agent 1 — N agent_version
agent 1 — N agent_task
agent_task 1 — N agent_execution (retries)
agent_execution 1 — N agent_execution_step
agent_execution 1 — N agent_approval
agent_version 1 — N agent_tool_grant
agent 1 — N agent_memory_item
agent 1 — N agent_event_trigger
agent 1 — N agent_schedule
agent_execution 1 — N agent_cost_record
agent 1 — N agent_quality_metric
```

**Cross-plane bridges:**

```
agent_task N — M task (Product Plane — agent work linked to product work)
agent_execution N — M pull_request (Build Plane — agent created this PR)
agent_execution N — M ci_run (Build Plane — agent triggered this build)
agent_execution N — M rollout (Fleet Plane — agent triggered this deployment)
agent_execution N — M audit_event (all planes — agent actions recorded)
```

---

## 9. API Surface

### 9.1 External APIs (Agent Gateway)

```
POST   /agents                          Register new agent
GET    /agents                          List agents (filterable by type, status, capability)
GET    /agents/{agent_id}               Get agent details
PATCH  /agents/{agent_id}               Update agent metadata
POST   /agents/{agent_id}/versions      Create new agent version
GET    /agents/{agent_id}/versions      List versions

POST   /tasks                           Submit task
GET    /tasks/{task_id}                 Get task status
POST   /tasks/{task_id}/cancel          Cancel task
GET    /tasks/{task_id}/executions      List executions for task

GET    /executions/{execution_id}       Get execution details
GET    /executions/{execution_id}/steps Get execution steps
POST   /executions/{execution_id}/replay Replay from step

POST   /approvals/{approval_id}/decide  Approve/reject pending action

GET    /models                          List available models
POST   /models                          Register model
PATCH  /models/{model_id}               Update model entry

GET    /tools                           List registered tools
POST   /tools                           Register MCP server

GET    /metrics/agents                  Agent fleet metrics
GET    /metrics/agents/{agent_id}       Per-agent metrics
GET    /metrics/costs                   Cost breakdown

GET    /memory/agents/{agent_id}        Query agent memory
GET    /memory/shared                   Query shared memory

WS     /stream/executions              Live execution stream
WS     /stream/approvals               Live approval requests
```

### 9.2 Internal APIs

```
factory-agent-api              Main API service
factory-agent-orchestrator     Task routing and agent coordination
factory-agent-executor         Temporal worker pool
factory-agent-memory           Memory read/write service
factory-agent-model-router     LLM abstraction and routing
factory-agent-cost-tracker     Cost aggregation and budget enforcement
factory-agent-quality-monitor  Quality metrics and drift detection
```

---

## 10. Event-Driven Integration

Agent Plane both **consumes** and **produces** events across Factory planes.

### 10.1 Events Consumed (Triggers)

| Source Plane   | Event                        | Agent Action                        |
| -------------- | ---------------------------- | ----------------------------------- |
| Build          | `pull_request.created`       | Trigger code review agent           |
| Build          | `build.failed`               | Trigger diagnostic agent            |
| Build          | `vulnerability.detected`     | Trigger security remediation agent  |
| Product        | `story.ready_for_dev`        | Trigger spec drafting agent         |
| Product        | `release.planned`            | Trigger release notes agent         |
| Fleet          | `site.health.degraded`       | Trigger incident response agent     |
| Fleet          | `rollout.completed`          | Trigger deployment validation agent |
| Infrastructure | `alert.fired`                | Trigger operations agent            |
| Infrastructure | `capacity.threshold_reached` | Trigger capacity planning agent     |
| Commerce       | `trial.expiring`             | Trigger usage analytics agent       |

### 10.2 Events Produced

| Event                          | Consumed By                        |
| ------------------------------ | ---------------------------------- |
| `agent.execution.completed`    | Product Plane (task status), Audit |
| `agent.execution.failed`       | Escalation, Alerting               |
| `agent.approval.required`      | Notification systems               |
| `agent.pr.created`             | Build Plane                        |
| `agent.rollout.triggered`      | Fleet Plane                        |
| `agent.cost.budget_exceeded`   | Cost management, Alerting          |
| `agent.quality.drift_detected` | Agent Plane (self-monitoring)      |

---

## 11. Non-Functional Requirements

### Scalability

- 50+ registered agents across all types
- 500+ concurrent task executions
- 10,000+ executions per day
- 100,000+ execution steps per day (LLM calls + tool calls)
- Memory store: 10M+ items with sub-100ms semantic retrieval

### Availability

- Agent Registry: 99.9% uptime
- Execution Engine: eventual consistency — queued tasks survive outages
- Model Router: automatic failover between providers within 5 seconds

### Latency

- Task submission to execution start: < 5 seconds (normal priority)
- LLM call overhead (routing + auth): < 200ms added latency
- Tool call overhead (MCP + auth): < 100ms added latency
- Memory retrieval: < 100ms for semantic search, < 50ms for graph traversal

### Security

- Zero trust — every inter-service call authenticated
- Execution-scoped tokens with explicit grants
- Secret injection at runtime, never in agent code
- Full audit trail, immutable, retained for 2 years minimum

---

## 12. Phased Implementation

### Phase 1 — Foundation (Months 1–3)

**Agent Registry:**

- Agent registration, versioning, lifecycle management
- Agent identity (principal type) integration with Factory identity system
- Basic Agent Card publication

**Execution Engine:**

- Temporal workflow infrastructure
- Single-agent execution (no delegation)
- Basic retry and timeout policies

**Model Router:**

- Single provider (Anthropic Claude) integration
- Basic routing (no fallback chains)
- Cost tracking per call

**Tool Registry:**

- MCP server registration
- `source-control-mcp` and `factory-build-mcp` servers
- Basic tool authorization (per-agent grants)

**First Agents:**

- Code Review Agent (engineering)
- Test Generation Agent (QA)
- Release Notes Agent (product)

**Human-in-the-Loop:**

- Basic approval flow for PR merges
- Slack notification integration

**Outcome:** Three working agents, end-to-end from trigger to output, with cost tracking and audit trail.

---

### Phase 2 — Scale (Months 4–6)

**Multi-Agent Coordination:**

- A2A protocol implementation
- Agent delegation and multi-agent workflows
- Sequential and parallel pipeline patterns

**Model Router (full):**

- Multi-provider support (Anthropic + OpenAI + local models)
- Capability-based routing with fallback chains
- Prompt caching

**Memory:**

- Vector store (pgvector) for agent memory
- Semantic retrieval in execution context
- Memory curator for selective persistence

**Remaining MCP Servers:**

- `factory-product-mcp`, `factory-fleet-mcp`, `factory-infra-mcp`, `security-scanner-mcp`

**Additional Agents:**

- Code Generation Agent (engineering)
- Backlog Grooming Agent (product)
- Dependency Scanner Agent (security)
- Incident Response Agent (operations)
- Health Monitor Agent (operations)

**Cost Management:**

- Budget enforcement (per-agent, per-team)
- Cost dashboards and weekly digests

**Quality Monitoring:**

- Acceptance rate tracking
- Basic drift detection

**Outcome:** Multi-agent workflows operational. All five agent types active. Cost and quality monitoring in place.

---

### Phase 3 — Maturity (Months 7–12)

**Knowledge Graph:**

- Shared memory as structured knowledge graph
- Entity relationship tracking (modules, services, deployments, incidents)
- Cross-agent knowledge sharing

**Advanced Orchestration:**

- Collaborative review patterns (multiple agents on one artifact)
- Conflict resolution between agent recommendations
- Dynamic agent selection based on task characteristics and historical performance

**Advanced Governance:**

- Automated permission audits (unused grants flagged)
- Grant expiry and renewal workflows
- Agent performance-based autonomy adjustments (high-performing agents get more autonomy)

**Full Agent Catalog:**

- Refactoring Agent, Documentation Agent (engineering)
- Regression Detection Agent, Deployment Validation Agent (QA)
- Spec Drafting Agent, Delivery Analytics Agent (product)
- Compliance Checker Agent, Secret Detection Agent (security)
- Rollout Agent, Capacity Planning Agent (operations)

**Air-Gapped Model Support:**

- Local model integration (Ollama/vLLM)
- Model registry with air-gapped availability tags
- Validation that all agents function with local models (capability degradation documented)

**Agent Marketplace (internal):**

- Teams can publish and share agent definitions
- Agent templates for common patterns
- Performance benchmarks per agent template

**Outcome:** Full automated software factory capability. All agent types operational with mature governance, cost controls, and quality monitoring. Air-gapped model support validated.

---

### Phase 4 — Future Horizon (12+ months)

**Self-Improving Agents:**

- Agents that analyze their own quality metrics and adjust prompts, tool selection, or strategies
- A/B testing of agent versions with automatic promotion of better performers
- Meta-agents that create and optimize other agents

**Predictive Automation:**

- Agents that anticipate work before it's assigned (e.g., "this module always needs performance testing before release — I'll start early")
- Proactive code maintenance agents that identify and fix technical debt before it causes issues

**Cross-Site Agent Reach:**

- Factory agents that can operate across Sites (with Site Control Plane authorization)
- Bridge between Factory Agent Plane and future Site-local agent capabilities
- Shared primitives (memory, tool registry) consumable by application-level agents

**Agent Simulation and Testing:**

- Sandbox environment for testing agent changes before production deployment
- Simulated task execution against historical data
- Agent performance benchmarking framework

**Agent-to-Human Protocol:**

- Structured handoff from agent to human when task exceeds agent capability
- Rich context transfer (what the agent tried, what worked, what didn't, what it recommends)
- Human feedback loop that improves future agent performance

---

## 13. Success Criteria

| Metric                                                     | Target      | Timeline |
| ---------------------------------------------------------- | ----------- | -------- |
| First agent (code review) operational end-to-end           | Working     | Month 2  |
| Three agent types active with audit trail                  | Working     | Month 3  |
| All five agent types active                                | Working     | Month 6  |
| Multi-agent workflow (code gen → test gen → security scan) | Working     | Month 5  |
| Agent cost tracking accurate to ±5%                        | Achieved    | Month 3  |
| Code review agent acceptance rate                          | > 70%       | Month 6  |
| Mean task execution time (code review)                     | < 5 minutes | Month 4  |
| Zero unauthorized agent actions (audit verified)           | Achieved    | Ongoing  |
| Air-gapped model support validated                         | Working     | Month 10 |
| 80% of routine PR reviews handled by agents                | Achieved    | Month 12 |
| Cost per agent-reviewed PR                                 | < $0.50     | Month 6  |

---

## 14. Explicit Boundaries

Agent Plane does **not**:

- Run inside customer Sites (Factory-scoped only)
- Implement application-level AI features (Service Plane modules)
- Own CI/CD pipelines (Build Plane — Agent Plane triggers them via MCP)
- Own monitoring infrastructure (Infrastructure Plane — Agent Plane consumes alerts)
- Own the work graph (Product Plane — Agent Plane reads and writes to it)
- Replace human judgment on novel or high-risk decisions
- Store customer data (no access to Site Data Plane)

Agent Plane **does**:

- Own agent identity, registration, and lifecycle
- Own execution infrastructure (Temporal workflows)
- Own the model abstraction layer
- Own the tool registry (MCP server catalog)
- Own agent memory (vector + graph)
- Own cost tracking and budget enforcement
- Own quality monitoring and drift detection
- Own agent-to-agent coordination (A2A)
- Own the human-in-the-loop approval system
- Own the audit trail for all agent actions

---

## 15. Relationship to Application-Level Agents

A note on the boundary between Factory Agent Plane and application-level AI (e.g., SmartMarket's AI Analyst).

**Factory Agent Plane** automates the company's internal software development and operations. It is infrastructure that engineers and operators interact with. Customers never see it.

**Application-level agents** (SmartMarket AI Analyst, future Trafficure AI copilot) are customer-facing product features. They run inside Sites, operate on customer data, and are subject to customer entitlements and Site Control Plane policies.

These are different constructs with different requirements:

| Concern       | Factory Agent Plane            | Application-Level Agents               |
| ------------- | ------------------------------ | -------------------------------------- |
| Scope         | Factory (one instance)         | Site (per deployment)                  |
| Users         | Engineers, operators           | Customers                              |
| Data access   | Source code, CI, fleet state   | Customer data                          |
| Governance    | Internal policies              | Customer entitlements, compliance      |
| Model hosting | Cloud or local (company infra) | Must support air-gapped customer infra |
| Cost model    | Internal budget                | Customer-billed or included in plan    |

**Shared primitives (future):** When the company builds application-level agent infrastructure, certain Agent Plane primitives may be extracted into shared libraries:

- Execution tracking patterns (Temporal workflow templates)
- Memory architecture (vector + graph hybrid)
- Model router abstraction
- MCP client implementations
- Quality monitoring patterns

This extraction is a Phase 4+ concern and will be planned separately. The Agent Plane PRD intentionally does not design for this reuse today — it optimizes for Factory automation first.

---

## 16. Open Questions

1. **Temporal hosting model.** Self-hosted Temporal vs. Temporal Cloud. Self-hosted aligns with air-gapped requirements but adds operational burden. Recommendation: start with Temporal Cloud for development velocity, plan self-hosted for production and air-gapped.

2. **Vector store selection.** pgvector (PostgreSQL extension — simpler ops, already in stack) vs. Qdrant (purpose-built — better performance at scale). Recommendation: start with pgvector for Phase 1–2, evaluate Qdrant if memory scale exceeds 10M items.

3. **Knowledge graph implementation.** Purpose-built graph DB (Neo4j) vs. PostgreSQL with recursive CTEs and JSONB. Recommendation: start with PostgreSQL (operational simplicity), evaluate graph DB if relationship traversal becomes a bottleneck.

4. **Agent prompt versioning.** How should prompt templates be versioned and stored? Git repository (version-controlled, reviewable) vs. database (dynamic, hot-reloadable). Recommendation: Git for source of truth, synced to database for runtime access.

5. **Multi-agent workflow definition language.** Should complex multi-agent workflows be defined declaratively (YAML/DSL) or programmatically (Temporal workflow code)? Declarative is more accessible but less flexible. Recommendation: start programmatic (Temporal), add declarative layer in Phase 3 when patterns stabilize.

6. **Agent evaluation framework.** How should new agent versions be evaluated before production deployment? Need a standardized benchmark suite per agent type with historical task data.

7. **Shared memory access control.** When multiple agents contribute to shared memory, how are conflicts resolved? Last-write-wins is insufficient for knowledge graphs. Need a merge strategy.

8. **LLM output caching.** For deterministic tool calls (e.g., "list all open PRs"), should results be cached to avoid redundant LLM reasoning? This reduces cost but risks stale data.

---

## Appendix A: Glossary

| Term           | Definition                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Agent          | An autonomous software entity with its own identity, capabilities, and execution lifecycle         |
| Agent Card     | A2A-compliant JSON manifest describing an agent's identity and capabilities                        |
| Agent Memory   | Persistent knowledge accumulated by an agent across executions                                     |
| Agent Type     | Classification (engineering, QA, product, security, operations) that determines default governance |
| A2A            | Agent-to-Agent Protocol — standard for inter-agent communication and task delegation               |
| Autonomy Level | Configurable setting determining how much human oversight an agent requires                        |
| Delegation     | An agent assigning a sub-task to another agent via A2A                                             |
| Drift          | Degradation in agent output quality over time                                                      |
| Execution      | A single invocation of an agent to perform a task, modeled as a Temporal workflow                  |
| Execution Step | An atomic action within an execution (LLM call, tool call, delegation)                             |
| MCP            | Model Context Protocol — standard for agent-to-tool connections                                    |
| Memory Curator | Classifier that decides whether execution outputs should be persisted to memory                    |
| Model Registry | Catalog of available LLM models with capabilities, costs, and availability                         |
| Model Router   | Service that resolves agent capability requirements to the best available model                    |
| Shared Memory  | Knowledge graph accessible by all agents, containing entity relationships                          |
| Tool Grant     | Explicit authorization for an agent version to use a specific MCP tool                             |

---

## Appendix B: Service Registry

```
Agent Plane Services:

factory-agent-api                Main API gateway
factory-agent-orchestrator       Task routing and agent coordination
factory-agent-executor           Temporal worker pool (execution runtime)
factory-agent-memory             Memory service (vector + graph)
factory-agent-model-router       LLM abstraction, routing, and caching
factory-agent-cost-tracker       Cost aggregation and budget enforcement
factory-agent-quality-monitor    Quality metrics, drift detection, alerting
factory-agent-mcp-registry       MCP server catalog and tool authorization
factory-agent-approval           Human-in-the-loop approval engine
factory-agent-event-listener     Event consumption from other Factory planes
```

---

## Appendix C: Technology Recommendations Summary

| Component                   | Recommendation                          | Rationale                                                              |
| --------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Execution Engine            | Temporal                                | Durable workflows, retries, saga, visibility — proven at scale         |
| Agent-to-Tool Protocol      | MCP                                     | Industry standard, Anthropic-originated, broad adoption                |
| Agent-to-Agent Protocol     | A2A                                     | Google-originated, complements MCP, vendor-neutral                     |
| Vector Store (Phase 1–2)    | pgvector                                | Already in stack (PostgreSQL), simpler ops, sufficient for early scale |
| Vector Store (Phase 3+)     | Qdrant (evaluate)                       | Purpose-built, better performance at 10M+ items                        |
| Knowledge Graph (Phase 1–2) | PostgreSQL + JSONB                      | Operational simplicity, sufficient for initial graph needs             |
| Knowledge Graph (Phase 3+)  | Neo4j (evaluate)                        | Purpose-built graph traversal if PostgreSQL becomes bottleneck         |
| Primary LLM Provider        | Anthropic Claude                        | Strong reasoning, tool use, code generation                            |
| Secondary LLM Provider      | OpenAI GPT                              | Fallback, specific capability gaps                                     |
| Local LLM (air-gapped)      | Ollama + Llama/Mistral                  | Open-source, self-hostable, good code generation                       |
| Prompt Storage              | Git (source of truth) + DB (runtime)    | Version control + hot reload                                           |
| Cost Tracking DB            | ClickHouse (if available) or PostgreSQL | Time-series cost data, aggregation queries                             |
