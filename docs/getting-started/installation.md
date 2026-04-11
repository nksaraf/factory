# Installation

## Install the DX CLI

```bash
# macOS / Linux
curl -fsSL https://get.factory.lepton.software | sh

# or via npm
npm install -g lepton-dx

# or via Bun
bun install -g lepton-dx
```

Verify the installation:

```bash
dx --version
```

## Prerequisites

| Requirement    | Version | Purpose                                      |
| -------------- | ------- | -------------------------------------------- |
| Node.js        | 20+     | Runtime for dx commands                      |
| Docker Desktop | Latest  | Local infrastructure (postgres, redis, etc.) |
| Git            | 2.30+   | Version control with hook support            |

## Setup

```bash
dx setup
```

This walks you through interactive setup — connecting to Factory, authenticating (internally calls `dx factory auth`), and configuring your workbench (laptop or VM). After setup, your session token is stored in `~/.config/dx/session.json`.

## For AI Agents

Agents authenticate via environment variable instead of browser login:

```bash
export DX_TOKEN=your-jwt-token
```

The JWT is validated via JWKS against the Factory API. All `dx` commands respect this token automatically.

## Verify Setup

```bash
dx status
```

This checks:

- API reachability
- Authentication status
- Docker availability
- Git configuration

## Update

```bash
dx self-update
```

## Next Steps

- [Quickstart](/getting-started/quickstart) — Go from zero to running in 5 minutes
- [Core Workflow](/getting-started/core-workflow) — Learn the development inner loop
