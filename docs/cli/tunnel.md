# dx tunnel

## Synopsis

```
dx tunnel <port> [flags]
dx tunnel list
dx tunnel close <tunnelId>
```

## Description

Expose a local port to the public internet via a Factory-managed tunnel. When opened, Factory assigns a subdomain (e.g. `abc123.tunnel.factory.lepton.software`) and forwards all inbound traffic to your local port. The process stays in the foreground and keeps the tunnel open until you press `Ctrl+C`.

Tunnels are ideal for sharing a local dev server with teammates, testing webhooks, or demonstrating work in progress without deploying. Use `--subdomain` to request a specific subdomain (subject to availability).

## Subcommands

| Subcommand   | Description                                   |
| ------------ | --------------------------------------------- |
| `list`       | List all active tunnels registered in Factory |
| `close <id>` | Force-close a specific tunnel by ID           |

## Flags (open)

| Flag          | Short | Type   | Description                  |
| ------------- | ----- | ------ | ---------------------------- |
| `--subdomain` | `-s`  | string | Request a specific subdomain |

## Examples

```bash
# Expose port 3000 with an auto-assigned subdomain
dx tunnel 3000

# Request a specific subdomain
dx tunnel 3000 --subdomain my-feature

# Expose port 8080 and get machine-readable output
dx tunnel 8080 --json

# List all active tunnels
dx tunnel list

# Force-close a specific tunnel
dx tunnel close abc123-tunnel-id
```

## Related Commands

- [`dx forward`](/cli/forward) — Port-forward from a remote host to localhost (inverse direction)
- [`dx route`](/cli/route) — Manage persistent gateway routes
- [`dx open`](/cli/open) — Open a workspace or resource in the browser
