# Testing

dx auto-detects your test runner and provides a consistent interface.

## Running Tests

```bash
dx test                    # Auto-detect and run tests
dx test api                # Test a specific component
dx test --watch            # Watch mode
dx test --coverage         # With coverage report
dx test --changed          # Only test changed files
dx test --integration      # Run integration tests
```

## Auto-Detection

dx finds your test runner automatically:

| Config File                         | Runner     |
| ----------------------------------- | ---------- |
| `vitest.config.ts`                  | Vitest     |
| `jest.config.ts` / `jest.config.js` | Jest       |
| `pyproject.toml [tool.pytest]`      | pytest     |
| `go.mod`                            | go test    |
| `Cargo.toml`                        | cargo test |

**Resolution order:**

1. `package.json` scripts — if a `test` script exists, it wins
2. Config file detection — auto-detect from project files
3. Clear error — tells you what to add

## Testing Philosophy

::: tip
Never assert broken behavior in tests. Tests should always assert the correct/expected behavior. If the code doesn't match yet, leave the test failing — that's fine. A failing test is a signal to fix the code, not to weaken the test.
:::

## For AI Agents

```bash
dx test --json             # Structured output
```

## Git Hook Integration

The `pre-push` hook runs `dx check`, which includes `dx test`. Tests must pass before code can be pushed.

## Related

- [Linting & Quality](/guides/linting-and-quality)
- [Core Workflow](/getting-started/core-workflow)
