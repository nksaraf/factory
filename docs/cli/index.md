# DX CLI Reference

The `dx` command-line tool is the primary interface for developing, testing, deploying, and managing software in Factory.

## Installation

```bash
# macOS / Linux
curl -fsSL https://get.factory.lepton.software | sh

# or via npm
npm install -g lepton-dx

# Verify
dx --version
```

## Global Flags

Every `dx` command supports these flags:

| Flag               | Description                   | When to Use         |
| ------------------ | ----------------------------- | ------------------- |
| `--json` / `-j`    | Structured JSON output        | Agents and scripts  |
| `--verbose` / `-v` | Detailed output               | Debugging dx itself |
| `--quiet` / `-q`   | Suppress non-essential output | CI/CD pipelines     |
| `--debug`          | Show HTTP/API traces          | Debugging API calls |
| `--help` / `-h`    | Show command help             | Learning a command  |

## Command Categories

### Inner Loop

Commands for day-to-day development.

| Command                    | Description                       |
| -------------------------- | --------------------------------- |
| [`dx up`](/cli/up)         | Start infrastructure services     |
| [`dx dev`](/cli/dev)       | Start dev servers with hot reload |
| [`dx down`](/cli/down)     | Stop all services                 |
| [`dx status`](/cli/status) | Check environment health          |
| [`dx test`](/cli/test)     | Run tests (auto-detects runner)   |
| [`dx lint`](/cli/lint)     | Run linter                        |
| [`dx check`](/cli/check)   | Run all quality checks            |
| [`dx logs`](/cli/logs)     | Tail container logs               |
| [`dx exec`](/cli/exec)     | Execute command in container      |

### Shipping

Commands for deployment and releases.

| Command                      | Description                 |
| ---------------------------- | --------------------------- |
| [`dx deploy`](/cli/deploy)   | Deploy to a target          |
| [`dx preview`](/cli/preview) | Manage preview environments |
| [`dx release`](/cli/release) | Create and manage releases  |

### Infrastructure

Commands for managing infrastructure.

| Command                      | Description                    |
| ---------------------------- | ------------------------------ |
| [`dx infra`](/cli/infra)     | Manage infrastructure entities |
| [`dx fleet`](/cli/fleet)     | Manage fleet (sites, tenants)  |
| [`dx ssh`](/cli/ssh)         | SSH into hosts/workspaces      |
| [`dx tunnel`](/cli/tunnel)   | Create tunnels                 |
| [`dx scan`](/cli/scan)       | Scan infrastructure            |
| [`dx cluster`](/cli/cluster) | Manage clusters                |

### Data & Config

Commands for databases and configuration.

| Command              | Description                  |
| -------------------- | ---------------------------- |
| [`dx db`](/cli/db)   | Database operations          |
| [`dx env`](/cli/env) | Manage environment variables |

### Catalog & Project

Commands for the software catalog.

| Command                          | Description                 |
| -------------------------------- | --------------------------- |
| [`dx catalog`](/cli/catalog)     | Browse the software catalog |
| [`dx open`](/cli/open)           | Open resources in browser   |
| [`dx route`](/cli/route)         | Manage routes               |
| [`dx workspace`](/cli/workspace) | Manage workspaces           |

## For AI Agents

- Always use `--json` when you need to parse dx output
- Use `dx status --json` to check environment health before taking action
- Use `dx db query --sql "..." --json` for database inspection
- Non-interactive: all commands work without TTY when flags are provided explicitly
- Authentication: set `DX_TOKEN` environment variable for API access
