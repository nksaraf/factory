# Preview Environments

Ephemeral deployments for PR/branch testing.

## Quick Start

```bash
# Deploy a preview from current branch
dx preview deploy

# View active previews
dx preview list

# Open in browser
dx preview open

# Teardown
dx preview destroy <id>
```

## How It Works

1. `dx preview deploy` builds a container image from your branch
2. Deploys it to the site's preview infrastructure
3. Creates a route with a unique URL
4. Preview auto-expires after TTL (default: 72h)

Preview URL format: `https://{branch-slug}.preview.{site-domain}`

## Status Lifecycle

```
pending_image → building → deploying → active → expired
```

## Configuration

Preview config lives in docker-compose labels or `package.json#dx`:

```json
{
  "dx": {
    "deploy": {
      "preview": {
        "trigger": "pull-request",
        "ttl": "72h",
        "authMode": "team"
      }
    }
  }
}
```

## Auth Modes

| Mode      | Access                      |
| --------- | --------------------------- |
| `public`  | Anyone with the URL         |
| `team`    | Team members only (default) |
| `private` | PR author only              |

## Runtime Classes

| Class  | Behavior                                   |
| ------ | ------------------------------------------ |
| `hot`  | Always running, fastest response           |
| `warm` | Scale-to-zero, cold start on first request |
| `cold` | On-demand provisioning                     |

## Related

- [Deploying](/guides/deploying)
- [Releases](/guides/releases)
