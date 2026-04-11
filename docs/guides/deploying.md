# Deploying to Production

## Deployment Flow

```bash
# 1. Create a release
dx release create 1.0.0

# 2. Deploy to a target
dx deploy create <release-id> --target <target-id>

# 3. Monitor
dx deploy status <deployment-id>
```

## Deployment Strategies

| Strategy     | Description                             | When to Use                          |
| ------------ | --------------------------------------- | ------------------------------------ |
| `rolling`    | Replace instances gradually             | Default, most services               |
| `blue-green` | Run two environments, swap traffic      | Zero-downtime for stateless services |
| `canary`     | Route small % of traffic to new version | High-risk changes                    |
| `stateful`   | Ordered replacement with data migration | Databases, stateful services         |

## The Deployment Model

```
Site (production-us)
  └── Tenant (acme-prod)
      └── System Deployment (auth-platform)
          ├── Deployment Set: stable (95% traffic)
          │   ├── auth-api (3 replicas, v1.9.0)
          │   └── auth-worker (2 replicas, v1.9.0)
          └── Deployment Set: canary (5% traffic)
              └── auth-api (1 replica, v2.0.0)
```

## Rollback

Deploy a previous release to roll back:

```bash
dx deploy create <previous-release-id> --target <target-id>
```

## Related

- [Releases](/guides/releases)
- [Previews](/guides/previews)
- [ops domain](/concepts/ops)
