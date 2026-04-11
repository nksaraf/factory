# dx run

## Synopsis

```
dx run <input> [flags] [-- passthrough args]
dx run list
dx run show <recipe>
```

## Description

Universal executor for scripts, recipes, and playbooks — locally or on remote machines. `dx run` detects the input type (TypeScript/JavaScript file, shell script, or named recipe) and dispatches accordingly.

TypeScript and JavaScript files run locally via Bun. Shell scripts can run locally or on remote machines via SSH using `--on`. Recipes are idempotent playbooks (e.g. `@dx/docker`) that install and configure software on remote machines — they support `--dry-run` to preview state without applying changes, and `--force` to re-apply even if the recipe reports it is already satisfied.

## Subcommands

| Subcommand      | Description                                   |
| --------------- | --------------------------------------------- |
| `list`          | List available recipes (built-in and custom)  |
| `show <recipe>` | Show recipe details, parameters, and metadata |

## Flags

| Flag              | Type    | Description                                                                           |
| ----------------- | ------- | ------------------------------------------------------------------------------------- |
| `--on <target>`   | string  | Target machine(s): slug, comma-separated slugs, `tag:<name>`, or `@inventory:<group>` |
| `--set key=value` | string  | Set a recipe parameter (repeatable)                                                   |
| `--dry-run`       | boolean | Check current state without applying changes                                          |
| `--force`         | boolean | Apply even if already applied                                                         |
| `--watch` / `-w`  | boolean | Re-run script on file changes (TS/JS files only)                                      |
| `--env`           | string  | Secret environment scope (`production`, `development`, `preview`)                     |
| `--secrets`       | boolean | Inject secrets (use `--no-secrets` to disable)                                        |

## Examples

```bash
# Run a TypeScript script locally
dx run script.ts

# Run a shell script on a remote machine
dx run setup.sh --on staging-1

# Install Docker via the built-in recipe
dx run @dx/docker --on staging-1

# Run a custom recipe with parameters (dry run first)
dx run ghost-cms --on prod --dry-run
dx run ghost-cms --on prod --set domain=blog.example.com

# Run a script on multiple hosts via a tag
dx run deploy.sh --on tag:workers

# Watch a local script for changes
dx run dev-check.ts --watch

# List all available recipes
dx run list
```

## Related Commands

- [`dx exec`](/cli/exec) — Execute a single command on a remote machine
- [`dx ssh`](/cli/ssh) — Open an interactive shell on a remote machine
- [`dx scan`](/cli/scan) — Scan infrastructure and sync to Factory
