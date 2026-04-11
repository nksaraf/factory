# dx release

## Synopsis

```
dx release <subcommand> [args] [flags]
```

## Description

`dx release` manages versioned software releases through their lifecycle: creation, status tracking, promotion, and content generation. Releases move through stages (`draft` → `staging` → `production`) via promotion and are deployed to targets using `dx deploy`.

The `content` subcommand uses an AI-assisted pipeline to generate changelogs, release notes, API docs, and announcements from a GitHub repository.

## Subcommands

| Subcommand                | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `create <version>`        | Create a new release                               |
| `list`                    | List releases                                      |
| `status <version>`        | Show the status of a release                       |
| `promote <version>`       | Promote a release to the next stage                |
| `content <version>`       | Generate release content (changelog, notes, docs)  |
| `bundle create <version>` | Create an offline bundle for air-gapped deployment |
| `bundle list`             | List release bundles                               |

## Flags

### `release create`

| Flag                  | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `--with-content`      | Also generate release content after creating                       |
| `--repo <owner/repo>` | Repository for content generation (required with `--with-content`) |

### `release list`

| Flag                | Short | Description                                                    |
| ------------------- | ----- | -------------------------------------------------------------- |
| `--status <status>` | `-s`  | Filter by status: `draft`, `staging`, `production`             |
| `--sort <field>`    |       | Sort by `version`, `status`, or `created` (default: `created`) |
| `--limit <n>`       | `-n`  | Limit results (default: 50)                                    |

### `release promote`

| Flag               | Short | Description                                                      |
| ------------------ | ----- | ---------------------------------------------------------------- |
| `--target <stage>` | `-t`  | Promotion target: `staging` or `production` (default: `staging`) |

### `release content`

| Flag                  | Description                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `--repo <owner/repo>` | Repository full name (required)                                                                         |
| `--outputs <list>`    | Comma-separated output types: `changelog`, `release-notes`, `api-docs`, `internal-docs`, `announcement` |

### `release bundle create`

| Flag                 | Description                                         |
| -------------------- | --------------------------------------------------- |
| `--role <role>`      | Bundle role: `site` (default), `factory`, or `both` |
| `--arch <arch>`      | Target architecture: `amd64` (default) or `arm64`   |
| `--dxVersion <ver>`  | `dx` CLI version to include in the bundle           |
| `--k3sVersion <ver>` | k3s version to include                              |

## Examples

```bash
# Create a new release
dx release create 1.2.0

# Create a release and generate content in one step
dx release create 1.2.0 --with-content --repo my-org/my-app

# List all releases
dx release list

# List only releases in staging
dx release list --status staging

# Check the status of a release
dx release status 1.2.0

# Promote a release to staging
dx release promote 1.2.0

# Promote directly to production
dx release promote 1.2.0 --target production

# Generate a changelog and release notes
dx release content 1.2.0 --repo my-org/my-app --outputs changelog,release-notes

# Create an offline bundle for air-gapped sites
dx release bundle create 1.2.0

# List all bundles
dx release bundle list
```

## Related Commands

- [`dx deploy`](./deploy.md) — Deploy a release to a target
- [`dx preview`](./preview.md) — PR preview environments
- [`dx build`](./build.md) — Build Docker images
