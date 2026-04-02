# Factory (Accra)

## Backlog

When ideas, features, or deferred work come up in conversation that won't be implemented right now, use `/backlog` to capture them in `BACKLOG.md` before ending the session. This prevents ideas from being lost across conversations.

At the end of any session where work was discussed but not completed, prompt the user: "Want me to run `/backlog` to capture deferred items?"

## Testing

- Never assert broken behavior in tests. Tests should always assert the correct/expected behavior. If the code doesn't match yet, leave the test failing — that's fine. A failing test is a signal to fix the code, not to weaken the test.
