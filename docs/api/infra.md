# Infra API

The `infra` domain models the physical and virtual infrastructure where software runs. It owns the "where" of the platform: **Estates** (ownership hierarchy — accounts, VPCs, datacenters), **Hosts** (individual machines), **Realms** (active governance scopes like Kubernetes clusters or Compose projects), and **Services** (consumed protocol endpoints like databases, queues, and SaaS providers).

**Base prefix:** `/api/v1/factory/infra`

## Endpoints

| Method   | Path                | Description                        |
| -------- | ------------------- | ---------------------------------- |
| `GET`    | `/estates`          | List all estates                   |
| `GET`    | `/estates/:slug`    | Get an estate by slug              |
| `POST`   | `/estates`          | Create an estate                   |
| `PATCH`  | `/estates/:slug`    | Update an estate                   |
| `DELETE` | `/estates/:slug`    | Delete an estate                   |
| `GET`    | `/hosts`            | List all hosts                     |
| `GET`    | `/hosts/:slug`      | Get a host by slug                 |
| `POST`   | `/hosts`            | Register a host                    |
| `PATCH`  | `/hosts/:slug`      | Update a host                      |
| `DELETE` | `/hosts/:slug`      | Delete a host                      |
| `POST`   | `/hosts/:slug/scan` | Trigger an infrastructure scan     |
| `GET`    | `/realms`           | List all realms                    |
| `GET`    | `/realms/:slug`     | Get a realm by slug                |
| `POST`   | `/realms`           | Create a realm                     |
| `PATCH`  | `/realms/:slug`     | Update a realm                     |
| `DELETE` | `/realms/:slug`     | Delete a realm                     |
| `GET`    | `/realm-hosts`      | List realm-host associations       |
| `GET`    | `/realm-hosts/:id`  | Get a realm-host association by id |
| `POST`   | `/realm-hosts`      | Add a host to a realm              |
| `PATCH`  | `/realm-hosts/:id`  | Update the host's role in a realm  |
| `DELETE` | `/realm-hosts/:id`  | Remove a host from a realm         |
| `GET`    | `/services`         | List all services                  |
| `GET`    | `/services/:slug`   | Get a service by slug              |
| `POST`   | `/services`         | Register a service                 |
| `PATCH`  | `/services/:slug`   | Update a service                   |
| `DELETE` | `/services/:slug`   | Delete a service                   |

## Query Parameters

All list endpoints accept:

| Parameter | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| `search`  | string | Full-text search across name, slug, and spec |
| `limit`   | number | Max results (default: 50, max: 500)          |
| `offset`  | number | Pagination offset                            |
| `type`    | string | Filter by entity type (see enums below)      |

Additional per-resource filters:

| Endpoint       | Extra Parameters                                                      |
| -------------- | --------------------------------------------------------------------- |
| `/estates`     | `parentEstateId`, `type` (`cloud-account`, `vpc`, `datacenter`, ...)  |
| `/hosts`       | `estateId`, `type` (`bare-metal`, `vm`, `lxc`, ...), `lifecycle`      |
| `/realms`      | `estateId`, `type`, `category` (`compute`, `network`, `storage`, ...) |
| `/realm-hosts` | `realmId`, `hostId`, `role` (`single`, `control-plane`, `worker`)     |
| `/services`    | `type` (`database`, `cache`, `queue`, `llm`, ...)                     |

### Estate types

`cloud-account`, `region`, `datacenter`, `vpc`, `subnet`, `rack`, `dns-zone`, `wan`, `cdn`

### Host types

`bare-metal`, `vm`, `lxc`, `cloud-instance`, `network-appliance`

### Realm types (selected)

`k8s-cluster`, `k8s-namespace`, `docker-engine`, `compose-project`, `systemd`, `proxmox`, `reverse-proxy`, `ceph`, `ollama`, `temporal-server`

### Service types

`database`, `cache`, `object-store`, `queue`, `search`, `cdn`, `managed-k8s`, `llm`, `auth-provider`, `ci-cd`, `source-control`, `monitoring`, `email`

## Examples

### List hosts

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/infra/hosts?type=vm&lifecycle=active"
```

```json
{
  "data": [
    {
      "id": "host_01hx4k9p2m",
      "slug": "prod-worker-01",
      "name": "Production Worker 01",
      "type": "vm",
      "estateId": "est_01hxproxmox",
      "spec": {
        "hostname": "prod-worker-01",
        "os": "linux",
        "arch": "amd64",
        "cpu": 8,
        "memoryMb": 16384,
        "diskGb": 200,
        "ipAddress": "192.168.2.50",
        "accessMethod": "ssh",
        "accessUser": "ubuntu",
        "sshPort": 22,
        "role": "k8s-agent",
        "lifecycle": "active",
        "externalId": "115"
      },
      "createdAt": "2025-06-01T10:00:00Z",
      "updatedAt": "2026-04-10T09:15:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 12 }
}
```

### Register a host

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "edge-node-nyc1",
    "name": "Edge Node NYC1",
    "type": "bare-metal",
    "estateId": "est_01hxnycdatacenter",
    "spec": {
      "hostname": "edge-nyc1.internal",
      "os": "linux",
      "arch": "amd64",
      "cpu": 16,
      "memoryMb": 32768,
      "diskGb": 960,
      "ipAddress": "10.0.1.50",
      "accessMethod": "ssh",
      "accessUser": "root",
      "sshPort": 22,
      "role": "edge-compute",
      "lifecycle": "active",
      "identityFile": "/home/ops/.ssh/edge_nyc_rsa"
    }
  }' \
  "https://factory.example.com/api/v1/factory/infra/hosts"
```

### Create a Proxmox estate

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "homelab-proxmox",
    "name": "Homelab Proxmox",
    "type": "datacenter",
    "spec": {
      "providerKind": "proxmox",
      "apiHost": "192.168.2.1",
      "apiPort": 8006,
      "tokenId": "root@pam!factory",
      "tokenSecret": "encrypted:pve_token_abc123",
      "sslFingerprint": "AA:BB:CC:DD:EE:FF",
      "lifecycle": "active",
      "location": "homelab-rack-1"
    }
  }' \
  "https://factory.example.com/api/v1/factory/infra/estates"
```

### Create a Kubernetes realm

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "prod-k8s",
    "name": "Production Kubernetes",
    "type": "k8s-cluster",
    "estateId": "est_01hxhomelab",
    "spec": {
      "category": "compute",
      "endpoint": "https://k8s.internal:6443",
      "kubeconfigRef": "secret:kubeconfig-prod",
      "version": "1.29.3",
      "status": "ready",
      "isDefault": true,
      "nodeCount": 5,
      "capacity": {
        "cpu": 40,
        "memoryMb": 81920,
        "pods": 500
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/infra/realms"
```

### Add a host to a realm

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "realmId": "realm_01hxprodk8s",
    "hostId": "host_01hxprodworker01",
    "role": "worker"
  }' \
  "https://factory.example.com/api/v1/factory/infra/realm-hosts"
```

### Register a database service

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "prod-postgres",
    "name": "Production PostgreSQL",
    "type": "database",
    "spec": {
      "provider": "self-hosted",
      "protocol": "postgresql",
      "version": "16.2",
      "endpoint": "postgres.internal:5432",
      "connectionString": "postgresql://app:encrypted_pass@postgres.internal:5432/appdb",
      "billing": {
        "plan": "dedicated",
        "cost": 0,
        "currency": "USD",
        "renewal": "monthly"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/infra/services"
```

### Trigger a host scan

Scans collect OS, CPU, memory, disk, running processes, open ports, and installed packages from the target host.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/infra/hosts/prod-worker-01/scan"
```

```json
{
  "data": {
    "scanId": "scan_01hx4k9p9v",
    "hostSlug": "prod-worker-01",
    "status": "running",
    "startedAt": "2026-04-11T08:30:00Z"
  }
}
```

## CLI equivalent

```bash
dx infra hosts list --json
dx infra hosts get prod-worker-01 --json
dx infra realms list --type k8s-cluster --json
dx infra scan prod-worker-01 --json
```
