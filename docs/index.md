---
layout: home
hero:
  name: Factory
  text: Build, deploy, and operate software at scale
  tagline: The complete platform for modeling your software organization — who builds, what's built, where it runs, how it ships, who pays.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/what-is-factory
    - theme: alt
      text: Mental Model
      link: /concepts/
    - theme: alt
      text: CLI Reference
      link: /cli/
features:
  - title: org — Actors & Identity
    details: Teams, principals, agents, threads, and memory. Model who builds and how they collaborate.
    link: /concepts/org
  - title: software — What Gets Built
    details: Systems, components, artifacts, and releases. Define your software from services to databases.
    link: /concepts/software
  - title: infra — Where Things Run
    details: Estate hierarchy, hosts, realms, and services. Map your entire infrastructure topology.
    link: /concepts/infra
  - title: ops — What Is Running
    details: Sites, tenants, deployments, and previews. Manage the operational state of your fleet.
    link: /concepts/ops
  - title: build — How It Ships
    details: Repos, pipelines, versions, and artifacts. Automate your build and release process.
    link: /concepts/build
  - title: commerce — Who Pays
    details: Customers, plans, subscriptions, and entitlements. Model your commercial relationships.
    link: /concepts/commerce
---

## For Developers

```bash
# Get started in 3 commands
dx up          # Start infrastructure
dx dev         # Start dev servers
dx status      # Check health
```

See the [Quickstart](/getting-started/quickstart) to go from zero to running in 5 minutes.

## For AI Agents

Factory is designed for both human developers and AI agents. Every `dx` command supports `--json` output, and the [Mental Model](/concepts/) provides a complete reference for understanding the platform's entity structure.

```bash
# Agent-friendly usage
dx status --json          # Structured health check
dx catalog list --json    # Browse the software catalog
dx db query --sql "..." --json  # Query databases
```

## Quick Links

| Resource                                        | Description                   |
| ----------------------------------------------- | ----------------------------- |
| [Installation](/getting-started/installation)   | Install the DX CLI            |
| [Core Workflow](/getting-started/core-workflow) | The development inner loop    |
| [Concepts](/concepts/)                          | The 6-domain mental model     |
| [CLI Reference](/cli/)                          | Every `dx` command documented |
| [API Reference](/api/)                          | REST API endpoints            |
| [Architecture](/architecture/)                  | How Factory is built          |
