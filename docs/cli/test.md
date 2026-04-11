# dx test

## Synopsis

```
dx test [components...] [flags]
```

## Description

`dx test` runs tests for your project, automatically detecting the test runner from your toolchain. It checks for `vitest` and `jest` config files, falls back to the `test` script in `package.json`, and supports variant scripts like `test:watch`, `test:coverage`, and `test:integration`.

In a multi-service project (docker-compose), you can target specific components by name. Without component names, `dx test` runs tests across the entire project using the top-level toolchain.

## Flags

| Flag            | Short | Description                                                |
| --------------- | ----- | ---------------------------------------------------------- |
| `--watch`       | `-w`  | Watch mode — re-run tests on file changes                  |
| `--coverage`    |       | Run with coverage reporting                                |
| `--changed`     |       | Only test files changed since the last commit              |
| `--integration` |       | Run integration tests (resolves `test:integration` script) |
| `--e2e`         |       | Run end-to-end tests (resolves `test:e2e` script)          |
| `--json`        |       | Emit machine-readable result output                        |
| `--quiet`       |       | Suppress toolchain detection messages                      |
| `--verbose`     |       | Show which components are being skipped and why            |

## Examples

```bash
# Run all tests
dx test

# Run tests for a specific component
dx test api

# Run tests for multiple components
dx test api shared

# Watch mode (re-runs on save)
dx test --watch

# Generate a coverage report
dx test --coverage

# Run only tests for files changed since last commit
dx test --changed

# Run integration tests
dx test --integration

# Machine-readable output for CI reporting
dx test --json
```

## Related Commands

- [`dx lint`](./lint.md) — Run the linter
- [`dx check`](./check.md) — Run all quality checks together
- [`dx build`](./build.md) — Build project artifacts
