# dx open

## Synopsis

```
dx open [target] [path] [flags]
```

## Description

Open a workspace in your editor or terminal. `dx open` resolves the target against local git worktrees first, then falls back to remote workspaces registered in Factory. If no target is given, an interactive picker lists all available local and remote workspaces.

For local worktrees, `dx open` launches Cursor or VS Code pointing at the worktree directory. For remote workspaces (k8s, VM), it uses the editor's built-in SSH remote extension (`ssh-remote+<slug>`). Use `--terminal` to get a shell instead of opening an editor.

The editor is auto-detected from your PATH (`cursor` preferred over `code`). Use `--editor` to force a specific editor.

## Flags

| Flag         | Short | Type    | Description                                              |
| ------------ | ----- | ------- | -------------------------------------------------------- |
| `--terminal` | `-t`  | boolean | Open a terminal session instead of an editor             |
| `--editor`   |       | string  | Editor to use: `cursor` or `code` (default: auto-detect) |

## Examples

```bash
# Interactive picker (shows local worktrees + remote workspaces)
dx open

# Open a local worktree in the auto-detected editor
dx open my-feature

# Open a remote workspace via SSH remote
dx open dev-vm

# Open a remote workspace at a specific path
dx open dev-vm /home/me/project

# Open a shell in a local worktree
dx open my-feature --terminal

# SSH into a remote workspace
dx open dev-vm --terminal

# Force VS Code instead of Cursor
dx open my-feature --editor code
```

## Related Commands

- [`dx workbench`](/cli/workbench) — Create, list, and manage workbenches
- [`dx ssh`](/cli/ssh) — Interactive SSH picker
- [`dx exec`](/cli/exec) — Run a command in a remote workspace
