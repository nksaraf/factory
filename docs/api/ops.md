# Ops API

The `ops` domain models everything that is currently running. It owns the "what is deployed" layer: **Sites** (deployment targets), **Tenants** (customer-isolated slices of a site), **Workspaces** (ephemeral developer/agent compute), **Workbenches** (registered developer machines), **System Deployments** (a system running on a site), **Deployment Sets** (versioned subsets for blue-green/canary), **Component Deployments** (per-component runtime status), **Previews** (ephemeral PR-linked environments), and **Databases** (per-deployment database instances).

**Base prefix:** `/api/v1/factory/ops`

## Endpoints

| Method   | Path                          | Description                                    |
| -------- | ----------------------------- | ---------------------------------------------- |
| `GET`    | `/sites`                      | List all sites                                 |
| `GET`    | `/sites/:slug`                | Get a site by slug                             |
| `POST`   | `/sites`                      | Create a site                                  |
| `PATCH`  | `/sites/:slug`                | Update a site                                  |
| `DELETE` | `/sites/:slug`                | Delete a site                                  |
| `POST`   | `/sites/:slug/checkin`        | Site controller check-in (update manifest)     |
| `POST`   | `/sites/:slug/assign-release` | Assign a release version to a site             |
| `GET`    | `/tenants`                    | List all tenants                               |
| `GET`    | `/tenants/:slug`              | Get a tenant by slug                           |
| `POST`   | `/tenants`                    | Create a tenant                                |
| `PATCH`  | `/tenants/:slug`              | Update a tenant                                |
| `DELETE` | `/tenants/:slug`              | Delete a tenant                                |
| `GET`    | `/workspaces`                 | List all workspaces                            |
| `GET`    | `/workspaces/:slug`           | Get a workspace by slug                        |
| `POST`   | `/workspaces`                 | Create a workspace                             |
| `PATCH`  | `/workspaces/:slug`           | Update a workspace                             |
| `DELETE` | `/workspaces/:slug`           | Delete a workspace                             |
| `POST`   | `/workspaces/:slug/extend`    | Extend workspace TTL                           |
| `POST`   | `/workspaces/:slug/snapshot`  | Snapshot a workspace                           |
| `POST`   | `/workspaces/:slug/resize`    | Resize workspace resources                     |
| `GET`    | `/workbenches`                | List all workbenches (registered dev machines) |
| `GET`    | `/workbenches/:slug`          | Get a workbench by slug                        |
| `POST`   | `/workbenches`                | Register a workbench                           |
| `PATCH`  | `/workbenches/:slug`          | Update a workbench                             |
| `DELETE` | `/workbenches/:slug`          | Deregister a workbench                         |
| `GET`    | `/system-deployments`         | List all system deployments                    |
| `GET`    | `/system-deployments/:slug`   | Get a system deployment by slug                |
| `POST`   | `/system-deployments`         | Create a system deployment                     |
| `PATCH`  | `/system-deployments/:slug`   | Update a system deployment                     |
| `DELETE` | `/system-deployments/:slug`   | Delete a system deployment                     |
| `GET`    | `/deployment-sets`            | List all deployment sets                       |
| `GET`    | `/deployment-sets/:slug`      | Get a deployment set by slug                   |
| `POST`   | `/deployment-sets`            | Create a deployment set                        |
| `PATCH`  | `/deployment-sets/:slug`      | Update a deployment set                        |
| `DELETE` | `/deployment-sets/:slug`      | Delete a deployment set                        |
| `GET`    | `/component-deployments`      | List all component deployments                 |
| `GET`    | `/component-deployments/:id`  | Get a component deployment by id               |
| `POST`   | `/component-deployments`      | Create a component deployment                  |
| `PATCH`  | `/component-deployments/:id`  | Update a component deployment                  |
| `DELETE` | `/component-deployments/:id`  | Delete a component deployment                  |
| `GET`    | `/previews`                   | List all preview environments                  |
| `GET`    | `/previews/:slug`             | Get a preview by slug                          |
| `POST`   | `/previews`                   | Create a preview environment                   |
| `PATCH`  | `/previews/:slug`             | Update a preview environment                   |
| `DELETE` | `/previews/:slug`             | Destroy a preview environment                  |
| `GET`    | `/databases`                  | List all database instances                    |
| `GET`    | `/databases/:slug`            | Get a database instance by slug                |
| `POST`   | `/databases`                  | Provision a database instance                  |
| `PATCH`  | `/databases/:slug`            | Update a database instance                     |
| `DELETE` | `/databases/:slug`            | Destroy a database instance                    |

## Query Parameters

All list endpoints accept:

| Parameter | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| `search`  | string | Full-text search across name, slug, and spec |
| `limit`   | number | Max results (default: 50, max: 500)          |
| `offset`  | number | Pagination offset                            |

Additional per-resource filters:

| Endpoint                 | Extra Parameters                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `/sites`                 | `type` — `shared`, `dedicated`, `on-prem`, `edge`; `status`                         |
| `/tenants`               | `siteId`, `customerId`, `environment`, `status`                                     |
| `/workspaces`            | `type` — `developer`, `agent`, `ci`, `playground`; `ownerPrincipalId`; `lifecycle`  |
| `/system-deployments`    | `systemId`, `siteId`, `tenantId`, `type` — `production`, `staging`, `dev`; `status` |
| `/deployment-sets`       | `systemDeploymentId`, `role`, `status`                                              |
| `/component-deployments` | `systemDeploymentId`, `deploymentSetId`, `componentId`, `status`                    |
| `/previews`              | `siteId`, `systemDeploymentId`, `status`; `branchName`                              |
| `/databases`             | `systemDeploymentId`, `type`                                                        |

## Examples

### Create a site

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "prod-us-east",
    "name": "Production US East",
    "spec": {
      "type": "dedicated",
      "status": "active",
      "previewConfig": {
        "enabled": true,
        "registry": "ghcr.io/example",
        "defaultAuthMode": "team",
        "containerPort": 3000
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/sites"
```

### Create a tenant

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "acme-prod",
    "name": "ACME (Production)",
    "siteId": "site_01hxproduseast",
    "customerId": "cust_01hxacme",
    "spec": {
      "environment": "production",
      "isolation": "siloed",
      "status": "active",
      "k8sNamespace": "tenant-acme",
      "resourceQuota": {
        "cpu": "4",
        "memory": "8Gi",
        "storage": "50Gi"
      },
      "previewConfig": {
        "enabled": true,
        "ttlDays": 3,
        "maxConcurrent": 5,
        "defaultAuthMode": "private"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/tenants"
```

### Create a system deployment

A system deployment attaches a software system to a site (and optionally a realm and tenant), tracking which version is running and how it should be reconciled.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-prod",
    "name": "Payments Platform (Production)",
    "type": "production",
    "systemId": "sys_01hxpayments",
    "siteId": "site_01hxproduseast",
    "tenantId": null,
    "realmId": "realm_01hxprodk8s",
    "spec": {
      "trigger": "release",
      "status": "active",
      "deploymentStrategy": "rolling",
      "desiredVersion": "2.1.0",
      "runtime": "kubernetes",
      "namespace": "payments",
      "labels": { "team": "commerce", "tier": "critical" }
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/system-deployments"
```

### Create a deployment set (blue-green)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-prod-green",
    "systemDeploymentId": "sysdep_01hxpaymentsprod",
    "realmId": "realm_01hxprodk8s",
    "spec": {
      "role": "green",
      "trafficWeight": 0,
      "status": "provisioning",
      "desiredVersion": "2.2.0",
      "testUrl": "https://payments-green.internal.example.com"
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/deployment-sets"
```

### Create a component deployment

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "systemDeploymentId": "sysdep_01hxpaymentsprod",
    "deploymentSetId": "dset_01hxpaymentsgreen",
    "componentId": "comp_01hxpayapi",
    "artifactId": "art_01hxpayapiv220",
    "spec": {
      "replicas": 3,
      "desiredImage": "ghcr.io/example/payments-api:v2.2.0",
      "envOverrides": {
        "LOG_LEVEL": "info",
        "FEATURE_RECURRING_BILLING": "true"
      },
      "resourceOverrides": {
        "cpu": "500m",
        "memory": "512Mi"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/component-deployments"
```

### Create a preview environment

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-pr-142",
    "name": "Payments PR #142",
    "siteId": "site_01hxproduseast",
    "systemDeploymentId": "sysdep_01hxpaymentsstaging",
    "spec": {
      "branchName": "feat/recurring-billing",
      "prNumber": 142,
      "prUrl": "https://github.com/example/payments/pull/142",
      "status": "provisioning",
      "authMode": "team",
      "ttlHours": 72,
      "urls": {
        "api": "https://payments-pr-142.preview.example.com"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/previews"
```

### Create a workspace

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "alice-payments-ws",
    "name": "Alice — Payments Workspace",
    "type": "developer",
    "ownerPrincipalId": "prin_01hxalice",
    "systemDeploymentId": "sysdep_01hxpaymentsdev",
    "spec": {
      "realmType": "container",
      "cpu": "4",
      "memory": "8Gi",
      "storageGb": 50,
      "repos": [
        { "url": "https://github.com/example/payments-api", "branch": "main", "clonePath": "/workspace/payments-api" }
      ],
      "authMode": "private",
      "lifecycle": "provisioning"
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/workspaces"
```

### Extend a workspace TTL

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "minutes": 120 }' \
  "https://factory.example.com/api/v1/factory/ops/workspaces/alice-payments-ws/extend"
```

### Site controller check-in

The site controller calls this endpoint periodically to report its state and receive reconciliation directives.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "healthy",
    "currentVersion": 5,
    "manifest": {
      "services": ["payments-api", "payments-worker"],
      "runningImages": {
        "payments-api": "ghcr.io/example/payments-api:v2.1.0",
        "payments-worker": "ghcr.io/example/payments-worker:v1.1.2"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/ops/sites/prod-us-east/checkin"
```

## CLI equivalent

```bash
dx ops sites list --json
dx ops system-deployments list --system payments-platform --json
dx ops workspaces list --json
dx ops previews list --site prod-us-east --json
dx workspace extend alice-payments-ws --minutes 60
```
