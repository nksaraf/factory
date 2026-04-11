# dx infra

## Synopsis

```
dx infra <entity> <subcommand> [flags]
```

## Description

Manage infrastructure entities in Factory: estates (providers), regions, realms (clusters/runtimes), hosts (VMs and bare-metal), services (deployed components), and IP addresses. All subcommands support `--json` for machine-readable output.

The infra command models the physical and logical layers of your infrastructure. Estates are provider accounts (Proxmox nodes, AWS accounts). Realms are execution environments within an estate — Kubernetes clusters, Docker engines, or systemd hosts. Hosts are individual machines. Services are running components.

## Subcommands

### Estate (`dx infra estate`)

| Subcommand      | Description                      |
| --------------- | -------------------------------- |
| `list`          | List all estates                 |
| `get <id>`      | Show estate details              |
| `create <name>` | Create an estate                 |
| `sync <id>`     | Trigger an estate inventory sync |

### Region (`dx infra region`)

| Subcommand      | Description         |
| --------------- | ------------------- |
| `list`          | List all regions    |
| `get <id>`      | Show region details |
| `create <name>` | Create a region     |
| `delete <id>`   | Delete a region     |

### Realm (`dx infra realm`)

| Subcommand      | Description        |
| --------------- | ------------------ |
| `list`          | List all realms    |
| `get <id>`      | Show realm details |
| `create <name>` | Create a realm     |
| `destroy <id>`  | Destroy a realm    |

### Host (`dx infra host`)

| Subcommand      | Description         |
| --------------- | ------------------- |
| `list`          | List all hosts      |
| `get <id>`      | Show host details   |
| `create <name>` | Register a new host |
| `delete <id>`   | Delete a host       |

### Service (`dx infra service`)

| Subcommand | Description          |
| ---------- | -------------------- |
| `list`     | List all services    |
| `get <id>` | Show service details |

## Flags

### Estate create

| Flag     | Type   | Description                                     |
| -------- | ------ | ----------------------------------------------- |
| `--type` | string | Estate type: `proxmox`, `hetzner`, `aws`, `gcp` |

### Realm create

| Flag           | Type   | Description                 |
| -------------- | ------ | --------------------------- |
| `--providerId` | string | Parent estate ID (required) |

### Host create / list

| Flag       | Type   | Description                |
| ---------- | ------ | -------------------------- |
| `--status` | string | Filter by status           |
| `--type`   | string | Host type (vm, bare-metal) |

## Examples

```bash
# List all estates (providers)
dx infra estate list

# List all realms (clusters/runtimes)
dx infra realm list

# List all hosts
dx infra host list

# Register a new estate
dx infra estate create my-proxmox --type proxmox

# Create a realm within an estate
dx infra realm create k8s-prod --providerId <estate-id>

# Trigger an estate sync to discover new hosts
dx infra estate sync <estate-id>

# Get JSON output for scripting
dx infra host list --json
```

## Related Commands

- [`dx fleet`](/cli/fleet) — Discover and import Compose stacks from hosts
- [`dx cluster`](/cli/cluster) — Manage Kubernetes clusters
- [`dx scan`](/cli/scan) — Scan hosts and sync to Factory
- [`dx ssh`](/cli/ssh) — SSH into a registered host
