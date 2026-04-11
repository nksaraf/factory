# Glossary

Canonical vocabulary for every concept in the Factory platform. Organized alphabetically.

[[toc]]

---

### Agent

An autonomous software entity — a first-class principal. Has autonomy levels (observer → supervisor), collaboration modes, and memory. Domain: **org**.

### Artifact

Immutable built output — container image, binary, or package. Content-addressable via digest. Produced by pipeline runs. Domain: **software/build**.

### Billable Metric

Measurement definition for usage-based billing. Aggregation types: sum, count, max, unique, last. Domain: **commerce**.

### Channel

See [Thread Channel](#thread-channel).

### Component

Unit of software within a system. Type-discriminated: application types (service, worker, task, cronjob, website, library, cli, agent, gateway, ml-model) and infrastructure types (database, cache, queue, storage, search). Domain: **software**.

### Component Deployment

Running instance of a component within a deployment set. Tracks replicas, image version, drift, env/resource overrides. Domain: **ops**.

### Customer

Buyer entity. Types: direct, reseller, partner. Status: trial → active → suspended → terminated. Domain: **commerce**.

### Deployment Set

Traffic tier within a system deployment. Enables blue/green, canary, primary/replica routing with traffic weights. Domain: **ops**.

### Entitlement Bundle

Signed capability token delivered to sites for offline enforcement. Contains feature list, site limits, and expiration. Domain: **commerce**.

### Estate

Recursive infrastructure ownership hierarchy. Types: cloud-account, region, datacenter, vpc, subnet, rack, dns-zone, wan, cdn. Domain: **infra**.

### Git Host Provider

Integration with external Git hosting. Types: github, gitlab, gitea, bitbucket. Auth: token, app, OAuth. Domain: **build**.

### Host

Physical or virtual machine. Types: bare-metal, vm, lxc, cloud-instance, network-appliance. Tracks OS, arch, CPU, memory, disk, IP, SSH config. Domain: **infra**.

### Identity Link

Federated identity mapping. Connects external accounts (GitHub, Google, Slack, Jira, Claude, Cursor) to a Factory principal. Domain: **org**.

### Job

Work unit assigned to an agent. Status: pending → claimed → running → completed/failed/cancelled. Has priority and optional deadline. Domain: **org**.

### Membership

Principal-to-team join with role. Roles: member, lead, admin. A principal can belong to multiple teams. Domain: **org**.

### Memory

Agent-learned fact that persists across sessions. Layers: session, team, org. Lifecycle: proposed → approved → superseded. Has confidence score. Domain: **org**.

### Pipeline Run

Single CI/CD execution. Triggers: push, pull_request, manual, schedule, tag. Contains pipeline steps. Domain: **build**.

### Pipeline Step

Individual task within a pipeline run (lint, test, build, deploy). Tracks command, exit code, duration, logs. Domain: **build**.

### Plan

Pricing tier for subscriptions. Types: base, add-on, suite. Price in cents with billing interval. Domain: **commerce**.

### Preview

Ephemeral deployment for PR/branch testing. Status: pending_image → building → deploying → active → expired. Has TTL, auth mode, runtime class. Domain: **ops**.

### Principal

Universal actor — the "who" behind every request. Types: human, agent, service-account. Every authenticated request in Factory traces to a principal. Domain: **org**.

### Realm

Active governance domain where workloads spawn. The key infrastructure abstraction. Categories: compute (k8s-cluster, docker-engine, systemd, etc.), network (reverse-proxy, firewall, etc.), storage (ceph, minio, etc.), AI/ML (ollama, vllm, etc.), build (docker-buildkit, etc.), scheduling (temporal-server, etc.). 30+ types. Domain: **infra**.

### Realm-Host

Many-to-many join between realms and hosts. A K8s cluster spans multiple hosts (control-plane, worker roles). Domain: **infra**.

### Release

Tagged, reproducible version of a system bundling specific artifacts. Semantic versioned. Domain: **software/ops**.

### Repo

Git repository. Kinds: product-module, platform-module, library, vendor-module, client-project, infra, docs, tool. Links to a system and team. Domain: **build**.

### Route

HTTP/gRPC traffic routing configuration. Kinds: ingress, sandbox, preview, tunnel, custom_domain. Domain: **ops**.

### Scope

Authorization boundary. Types: team-derived, resource-level, custom. Contains permission strings. Domain: **org**.

### Service

Anything consumed via protocol/API — managed database, cache, LLM, issue tracker, payment processor. Links to estate for billing traceability. Domain: **infra**.

### Site

Purpose container for deployments. Types: shared (multi-tenant SaaS), dedicated (single-tenant), on-prem (customer-hosted), edge. Domain: **ops**.

### Subscription

Active subscription linking a customer to a plan. Status: active, past_due, cancelled, trialing, paused. Domain: **commerce**.

### Subscription Item

Metered feature within a subscription. Tracks quantity, usage limit, and overage policy (block/charge/notify). Domain: **commerce**.

### System

Top-level product or platform — the highest organizational unit of software. Has owner team, namespace, lifecycle. Domain: **software**.

### System Deployment

Running instance of a system on a site/tenant/realm. Deployment kinds: production, staging, dev. Strategies: rolling, blue-green, canary, stateful. Domain: **ops**.

### System Version

Tagged version of a system with commit SHA and release notes. Domain: **build**.

### Team

Hierarchical organizational unit. Types: team, business-unit, product-area. Has parent for nesting. Teams own systems, components, and infrastructure. Domain: **org**.

### Template

Reusable workspace definition for scaffolding. Includes devcontainer config, dependencies, commands. Domain: **software**.

### Tenant

Customer or internal team scoped to a site. Isolation modes: dedicated (own infra), shared (app-level RLS), siloed (own K8s namespace). Domain: **ops**.

### Thread

Universal conversation primitive. Types: ide-session, chat, terminal, review, autonomous. Has participants, turns, and multi-surface mirroring via channels. Domain: **org**.

### Thread Channel

Multi-surface mirroring join. A thread appears in multiple places: IDE, Slack, terminal, GitHub PR, web UI. Domain: **org**.

### Thread Turn

Single request-response exchange within a thread. Contains prompt, response, tool calls, token usage, model used. Domain: **org**.

### Tool Credential

Encrypted API key or token for agent tool access. Domain: **org**.

### Tool Usage

Cost and usage tracking per principal per tool. Tracks token count and cost. Domain: **org**.

### Workbench

Generalized compute environment abstraction. Types: worktree, container, vm, namespace, pod, bare-process, function, sandbox, edge-worker, static. Domain: **ops**.

### Workspace

Developer or agent isolated compute environment. Types: developer, agent, ci, playground. Has health status and resource quotas. Domain: **ops**.

### Workspace Snapshot

Point-in-time disk state of a workspace for cloning/restoring. Domain: **ops**.

---

## Terminology Decisions

These vocabulary choices are intentional. Use the Factory term, not the alternatives.

| Factory Term  | Not                     | Why                                                                 |
| ------------- | ----------------------- | ------------------------------------------------------------------- |
| **System**    | Service, Product        | "Service" is overloaded (K8s); System is the top-level unit         |
| **Component** | Service, Container      | "Service" is a K8s network endpoint; Component is a deployable unit |
| **Artifact**  | Build Output            | Clear, immutable, content-addressable                               |
| **Site**      | Environment, Deployment | Unambiguous — a running instance with specific purpose              |
| **Realm**     | Cluster, Engine         | Generalized — covers K8s, Docker, systemd, and 25+ more types       |
| **Estate**    | Provider, Account       | Recursive hierarchy, not just a single account                      |
| **Tenant**    | Customer, Namespace     | Runtime tenancy boundary with isolation modes                       |
| **Principal** | User, Account           | Universal — covers humans, agents, and service accounts             |
| **Thread**    | Conversation, Chat      | Universal — covers IDE, terminal, Slack, and autonomous work        |
