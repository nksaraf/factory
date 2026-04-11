# dx lint

## Synopsis

```
dx lint [flags]
```

## Description

`dx lint` runs the linter for the current project, auto-detecting the tool in use. It looks for ESLint and Biome config files, then falls back to the `lint` script in `package.json`. When auto-detected, the config file that triggered detection is shown so you know exactly what ran.

## Flags

| Flag      | Description                                                     |
| --------- | --------------------------------------------------------------- |
| `--fix`   | Auto-fix lint issues where possible                             |
| `--json`  | Emit machine-readable output with tool name, source, and result |
| `--quiet` | Suppress the toolchain detection message                        |

## Examples

```bash
# Run the auto-detected linter
dx lint

# Auto-fix all fixable issues
dx lint --fix

# Machine-readable output
dx lint --json
```

## Related Commands

- [`dx check`](./check.md) — Run all quality checks (lint + format + typecheck + test)
- [`dx test`](./test.md) — Run tests
- [`dx build`](./build.md) — Build project artifacts
