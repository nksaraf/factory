# Installation

## Install the DX CLI

```bash
# macOS / Linux
curl -fsSL https://get.factory.dev | sh

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

## Authenticate

```bash
dx auth login
```

This opens a browser for OAuth authentication. After login, your session token is stored in `~/.config/dx/session.json`.

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
