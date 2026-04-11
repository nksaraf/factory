# Commerce API

The `commerce` domain models the business layer of the platform. It tracks who is paying, what they are paying for, and what they are entitled to use. The key entities are **Customers** (external or internal billing accounts), **Plans** (product offering tiers), **Subscriptions** (a customer's active plan), **Subscription Items** (individual line items within a subscription), **Billable Metrics** (usage signals that drive metered billing), and **Entitlement Bundles** (sets of feature flags and limits attached to a plan).

**Base prefix:** `/api/v1/factory/commerce`

## Endpoints

| Method   | Path                         | Description                       |
| -------- | ---------------------------- | --------------------------------- |
| `GET`    | `/customers`                 | List all customers                |
| `GET`    | `/customers/:slug`           | Get a customer by slug            |
| `POST`   | `/customers`                 | Create a customer                 |
| `PATCH`  | `/customers/:slug`           | Update a customer                 |
| `DELETE` | `/customers/:slug`           | Delete a customer                 |
| `GET`    | `/plans`                     | List all plans                    |
| `GET`    | `/plans/:slug`               | Get a plan by slug                |
| `POST`   | `/plans`                     | Create a plan                     |
| `PATCH`  | `/plans/:slug`               | Update a plan                     |
| `DELETE` | `/plans/:slug`               | Delete a plan                     |
| `GET`    | `/subscriptions`             | List all subscriptions            |
| `GET`    | `/subscriptions/:slug`       | Get a subscription by slug        |
| `POST`   | `/subscriptions`             | Create a subscription             |
| `PATCH`  | `/subscriptions/:slug`       | Update a subscription             |
| `DELETE` | `/subscriptions/:slug`       | Cancel a subscription             |
| `GET`    | `/subscription-items`        | List all subscription items       |
| `GET`    | `/subscription-items/:id`    | Get a subscription item by id     |
| `POST`   | `/subscription-items`        | Add an item to a subscription     |
| `PATCH`  | `/subscription-items/:id`    | Update a subscription item        |
| `DELETE` | `/subscription-items/:id`    | Remove a subscription item        |
| `GET`    | `/billable-metrics`          | List all billable metrics         |
| `GET`    | `/billable-metrics/:slug`    | Get a billable metric by slug     |
| `POST`   | `/billable-metrics`          | Define a billable metric          |
| `PATCH`  | `/billable-metrics/:slug`    | Update a billable metric          |
| `DELETE` | `/billable-metrics/:slug`    | Delete a billable metric          |
| `GET`    | `/entitlement-bundles`       | List all entitlement bundles      |
| `GET`    | `/entitlement-bundles/:slug` | Get an entitlement bundle by slug |
| `POST`   | `/entitlement-bundles`       | Create an entitlement bundle      |
| `PATCH`  | `/entitlement-bundles/:slug` | Update an entitlement bundle      |
| `DELETE` | `/entitlement-bundles/:slug` | Delete an entitlement bundle      |

## Query Parameters

All list endpoints accept:

| Parameter | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| `search`  | string | Full-text search across name, slug, and spec |
| `limit`   | number | Max results (default: 50, max: 500)          |
| `offset`  | number | Pagination offset                            |

Additional per-resource filters:

| Endpoint               | Extra Parameters                                                                 |
| ---------------------- | -------------------------------------------------------------------------------- |
| `/customers`           | `status` — `active`, `suspended`, `churned`; `externalId`                        |
| `/plans`               | `status` — `active`, `archived`; `billingInterval` — `monthly`, `annual`         |
| `/subscriptions`       | `customerId`, `planId`, `status` — `trialing`, `active`, `past_due`, `cancelled` |
| `/subscription-items`  | `subscriptionId`, `planItemId`, `type` — `flat`, `metered`, `tiered`             |
| `/billable-metrics`    | `type` — `count`, `sum`, `max`, `unique_count`; `aggregation`                    |
| `/entitlement-bundles` | `planId`                                                                         |

## Examples

### Create a customer

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "acme-corp",
    "name": "ACME Corporation",
    "spec": {
      "status": "active",
      "email": "billing@acme.example.com",
      "externalId": "cus_stripe_acme123",
      "billingProvider": "stripe",
      "country": "US",
      "metadata": {
        "salesforceAccountId": "001xx000003GYkl",
        "segment": "enterprise"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/commerce/customers"
```

### List customers

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/commerce/customers?status=active&limit=25"
```

```json
{
  "data": [
    {
      "id": "cust_01hxacme",
      "slug": "acme-corp",
      "name": "ACME Corporation",
      "spec": {
        "status": "active",
        "email": "billing@acme.example.com",
        "externalId": "cus_stripe_acme123",
        "billingProvider": "stripe",
        "country": "US"
      },
      "createdAt": "2025-03-01T09:00:00Z",
      "updatedAt": "2026-01-15T12:00:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 48 }
}
```

### Create a plan

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "growth",
    "name": "Growth",
    "spec": {
      "status": "active",
      "description": "For scaling teams. Includes unlimited previews and 10 seats.",
      "billingInterval": "monthly",
      "currency": "USD",
      "basePrice": 29900,
      "trialDays": 14,
      "externalId": "price_stripe_growth_monthly",
      "billingProvider": "stripe",
      "tags": ["self-serve", "smb"]
    }
  }' \
  "https://factory.example.com/api/v1/factory/commerce/plans"
```

### Create a subscription

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "acme-growth-2026",
    "name": "ACME Growth Subscription",
    "customerId": "cust_01hxacme",
    "planId": "plan_01hxgrowth",
    "spec": {
      "status": "active",
      "startedAt": "2026-01-01T00:00:00Z",
      "currentPeriodStart": "2026-04-01T00:00:00Z",
      "currentPeriodEnd": "2026-05-01T00:00:00Z",
      "cancelAtPeriodEnd": false,
      "externalId": "sub_stripe_acme_growth",
      "billingProvider": "stripe",
      "seats": 10
    }
  }' \
  "https://factory.example.com/api/v1/factory/commerce/subscriptions"
```

### Add a metered subscription item

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "sub_01hxacmegrowth",
    "spec": {
      "type": "metered",
      "metricSlug": "preview-build-minutes",
      "pricePerUnit": 2,
      "currency": "USD",
      "unitLabel": "minute",
      "externalId": "si_stripe_acme_preview_minutes",
      "includedUnits": 500
    }
  }' \
  "https://factory.example.com/api/v1/factory/commerce/subscription-items"
```

### Define a billable metric

Billable metrics define what usage events are collected and how they are aggregated for billing.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "preview-build-minutes",
    "name": "Preview Build Minutes",
    "spec": {
      "description": "CPU-minutes consumed building and running preview environments",
      "aggregation": "sum",
      "type": "sum",
      "eventName": "preview.build.completed",
      "fieldName": "durationSeconds",
      "unitTransform": "seconds_to_minutes",
      "filters": [
        { "field": "status", "operator": "eq", "value": "succeeded" }
      ],
      "externalId": "bm_lago_preview_build_minutes"
    }
  }' \
  "https://factory.example.com/api/v1/factory/commerce/billable-metrics"
```

### Create an entitlement bundle

Entitlement bundles define the feature flags and hard limits granted by a plan. The platform checks these at runtime to enforce plan boundaries.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "growth-entitlements",
    "name": "Growth Plan Entitlements",
    "planId": "plan_01hxgrowth",
    "spec": {
      "description": "Entitlements for the Growth plan",
      "features": {
        "previews": true,
        "agentWorkspaces": true,
        "customDomains": false,
        "ssoIntegration": false,
        "auditLog": true
      },
      "limits": {
        "seats": 10,
        "previews": -1,
        "workspaces": 20,
        "buildMinutesPerMonth": 5000,
        "storageGb": 100
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/commerce/entitlement-bundles"
```

### Check a customer's entitlements

To resolve which entitlement bundle applies to a customer, fetch their active subscription and look up the plan's bundle:

```bash
# 1. Get active subscriptions for the customer
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/commerce/subscriptions?customerId=cust_01hxacme&status=active"

# 2. Get the entitlement bundle for the plan
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/commerce/entitlement-bundles?planId=plan_01hxgrowth"
```

## CLI equivalent

```bash
dx commerce customers list --json
dx commerce subscriptions list --customer acme-corp --json
dx commerce plans get growth --json
dx commerce entitlement-bundles get growth-entitlements --json
```
