# dx agent

## Synopsis

```
dx agent list
dx agent run <name>
dx agent show <name>
dx agent skill <subcommand> [flags]
```

## Description

Manage AI agents and their skills. Agents are configured AI assistants (Claude Code, Cursor, etc.) that can be extended with **skills** — SKILL.md packages that give agents specialized capabilities, domain knowledge, and slash commands.

Skills can be installed globally (user-level) or per-project, and scoped to specific agents. The `dx agent skill sync` command installs your organization's internal skill library from the monorepo `skills/` directory into all configured agents.

## Subcommands

### Agent

| Subcommand    | Description            |
| ------------- | ---------------------- |
| `list`        | List registered agents |
| `run <name>`  | Run an agent           |
| `show <name>` | Show agent details     |

### Skill (`dx agent skill`)

| Subcommand        | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `add <package>`   | Add a skill from GitHub (`user/repo` or URL)           |
| `remove [skills]` | Remove installed skills (interactive if omitted)       |
| `list`            | List installed skills                                  |
| `find [query]`    | Search for skills interactively                        |
| `check`           | Check for available skill updates                      |
| `update`          | Update all skills to latest versions                   |
| `init [name]`     | Initialize a new skill (creates `SKILL.md`)            |
| `sync`            | Install org's internal skills from `skills/` directory |

## Flags

### `skill add` / `skill remove`

| Flag       | Short | Type    | Description                                               |
| ---------- | ----- | ------- | --------------------------------------------------------- |
| `--global` | `-g`  | boolean | Install/remove globally instead of project-level          |
| `--agent`  | `-a`  | string  | Target agent(s): `claude-code`, `cursor`, or `*` for all  |
| `--skill`  | `-s`  | string  | Specific skill name(s) to install/remove (or `*` for all) |
| `--all`    |       | boolean | Shorthand for `--skill '*' --agent '*' --yes`             |
| `--yes`    | `-y`  | boolean | Skip confirmation prompts                                 |

### `skill list`

| Flag       | Short | Type    | Description                           |
| ---------- | ----- | ------- | ------------------------------------- |
| `--global` | `-g`  | boolean | List global skills (default: project) |
| `--agent`  | `-a`  | string  | Filter by specific agent              |

### `skill sync`

| Flag      | Short | Type   | Description                |
| --------- | ----- | ------ | -------------------------- |
| `--agent` | `-a`  | string | Target agent(s) to sync to |

## Examples

```bash
# List registered agents
dx agent list

# Add a skill from GitHub
dx agent skill add user/my-skill-repo

# Add a skill globally for all agents
dx agent skill add user/my-skill-repo --global --all

# List installed skills
dx agent skill list

# List global skills
dx agent skill list -g

# Find a skill interactively
dx agent skill find

# Search for skills by keyword
dx agent skill find "docker"

# Check for updates
dx agent skill check

# Update all skills
dx agent skill update

# Sync org's internal skill library
dx agent skill sync

# Create a new skill package
dx agent skill init my-skill
```

## Related Commands

- [`dx run`](/cli/run) — Run scripts and recipes (agent-friendly)
- [`dx catalog`](/cli/catalog) — Browse the software catalog (context for agents)
- [`dx workbench`](/cli/workbench) — Manage workbenches where agents operate
