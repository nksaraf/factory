# dx format

## Synopsis

```
dx format [flags]
```

## Description

Run the auto-detected formatter for the current project. `dx format` reads your project's `package.json` and configuration files to determine the appropriate formatter — Prettier or Biome — and runs it with the correct arguments.

The formatter is selected in this order:

1. A `"format"` script in `package.json` (used as-is)
2. Auto-detected from `.prettierrc` / `prettier.config.*` → runs `prettier --write .`
3. Auto-detected from `biome.json` → runs `biome format --write .`

Use `--check` to verify formatting without modifying files — useful in CI.

## Flags

| Flag      | Type    | Description                                                                     |
| --------- | ------- | ------------------------------------------------------------------------------- |
| `--check` | boolean | Check formatting without writing changes (exits non-zero if formatting differs) |

## Examples

```bash
# Format all files in the project
dx format

# Check formatting in CI (no writes)
dx format --check

# Machine-readable result
dx format --json
```

## Related Commands

- [`dx lint`](/cli/lint) — Run the linter
- [`dx check`](/cli/check) — Run all quality checks (format, lint, typecheck, test)
- [`dx typecheck`](/cli/typecheck) — Run TypeScript type checking
