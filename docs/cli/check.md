# dx check

## Synopsis

```
dx check [subcommand] [flags]
```

## Description

`dx check` runs all quality checks in one command: linting, type checking, tests, and formatting. It is the recommended way to validate your code before committing or opening a PR. In CI mode (`--ci`), exit codes follow the `block_pr` conventions configured in the project.

Each check type can be run individually as a subcommand, or with `--component` to scope to a single service.

## Subcommands

| Subcommand  | Description            |
| ----------- | ---------------------- |
| `lint`      | Run linting only       |
| `typecheck` | Run type checking only |
| `test`      | Run tests only         |
| `format`    | Check formatting only  |

## Flags

| Flag                 | Short | Description                                        |
| -------------------- | ----- | -------------------------------------------------- |
| `--component <name>` | `-c`  | Target a specific component                        |
| `--staged`           |       | Only check staged files (pre-commit mode)          |
| `--ci`               |       | CI mode: exit code based on `block_pr` conventions |
| `--fix`              |       | Auto-fix lint and format issues where possible     |
| `--report <format>`  |       | Output format: `summary` (default) or `json`       |

## Examples

```bash
# Run all quality checks
dx check

# Run all checks in CI mode
dx check --ci

# Auto-fix lint and format issues
dx check --fix

# Run only linting
dx check lint

# Run only type checking
dx check typecheck

# Run only tests
dx check test

# Check formatting
dx check format

# Lint a specific component
dx check lint -c api

# Check only staged files before committing
dx check --staged
```

## Related Commands

- [`dx lint`](./lint.md) — Run the linter standalone
- [`dx test`](./test.md) — Run tests standalone
- [`dx build`](./build.md) — Build project artifacts
