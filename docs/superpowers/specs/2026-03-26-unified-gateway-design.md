# Unified Gateway: Complete URL/DNS/Routing Architecture

## Context

Factory has multiple resource types that need public URLs — tunnels, previews, sandboxes, production/staging targets, custom domains. Today there are two parallel routing systems (route table → `traefik-sync.ts` YAML, and K8s IngressRoute CRDs), both creating per-instance Traefik routers. This won't scale to 10K+ previews.

**Core principle**: Cardinality lives in **data** (DB rows + cached lookup), not **edge config** (Traefik routers/DNS records/certs).

---

## Part 1: DNS & TLS (Set Once, Never Touch Again)

### Wildcard DNS Records (4 total)

```
*.tunnel.dx.dev    → A → edge IP
*.preview.dx.dev   → A → edge IP    (previews + factory sandboxes)
*.sandbox.dx.dev   → A → edge IP    (if separating sandboxes from previews)
*.dx.dev           → A → edge IP    (prod/staging targets + site-scoped resources)
```

Never create per-instance DNS records.

### Wildcard TLS Certs (auto-renewed via Let's Encrypt DNS-01)

```
*.tunnel.dx.dev
*.preview.dx.dev
*.sandbox.dx.dev
*.dx.dev
```

Custom domains get individual certs (low cardinality, fine).

---

## Part 2: Traefik (Static Config, ~5 Routers)

### High-cardinality families → Factory Gateway

```yaml
http:
  routers:
    tunnel-family:
      rule: "HostRegexp(`{sub:.+}.tunnel.dx.dev`)"
      service: factory-gateway
      tls: { certResolver: wildcard-tunnel }
    preview-family:
      rule: "HostRegexp(`{sub:.+}.preview.dx.dev`)"
      service: factory-gateway
      tls: { certResolver: wildcard-preview }
    sandbox-family:
      rule: "HostRegexp(`{sub:.+}.sandbox.dx.dev`)"
      service: factory-gateway
      tls: { certResolver: wildcard-sandbox }
  services:
    factory-gateway:
      loadBalancer:
        servers:
          - url: "http://factory-gateway:9090"
```

### Low-cardinality → keep per-route Traefik routers

- **Prod/staging targets** (`*.dx.dev`): K8s IngressRoute CRDs (tens, not thousands)
- **Custom domains**: Per-domain Traefik router via `traefik-sync.ts` (low cardinality)
- **Ingress routes** (`kind: "ingress"`): Same as today

`traefik-sync.ts` changes: only generate per-route routers for `kind === "custom_domain"` and `kind === "ingress"`. All other kinds are handled by the gateway.

---

## Part 3: Factory Gateway (The Unified Smart Proxy)

**File**: `api/src/modules/infra/factory-gateway.ts` (new)

A Bun HTTP server on port 9090 (same process as API, different port) that handles ALL high-cardinality routing.

### Request Flow

```
Request arrives → Parse Host header
    ↓
Determine family:
  *.tunnel.dx.dev   → tunnel
  *.preview.dx.dev  → preview (or sandbox if slug matches)
  *.sandbox.dx.dev  → sandbox
    ↓
Extract slug from hostname
    ↓
Lookup pipeline:
  LRU cache (< 1ms) → Redis (< 5ms, optional) → Postgres route table (< 20ms)
    ↓
Route by kind:
  tunnel     → relay through WebSocket (binary frames) to CLI client
  preview    → check runtimeClass, then reverse proxy to k8s service
  sandbox    → reverse proxy to sandbox pod
    ↓
Stream response back to caller
```

### Routing Decisions by State

| Kind | Status/State | Gateway Action |
|------|-------------|----------------|
| tunnel (active) | WS connected | Binary frame relay to CLI |
| tunnel (disconnected) | WS gone | 502 Bad Gateway |
| preview (hot) | k8s running | Reverse proxy to service |
| preview (warm) | scaled to 0 | Trigger scale-up, return "Starting..." with auto-refresh |
| preview (cold) | no workload | Trigger deploy, return "Starting..." page |
| preview (expired) | past expiresAt | 410 Gone / branded expiry page |
| preview (building) | CI in progress | "Building preview..." page with status |
| sandbox (active) | pod running | Reverse proxy to pod |
| sandbox (expired) | past expiresAt | 410 Gone |
| any (not found) | no route match | 404 Not Found |

### Cache Invalidation

- On route create/update/delete in `gateway.service.ts`, invalidate LRU entry
- Same-process: direct function call to gateway's cache
- Multi-replica (future): Redis pub/sub or polling
- TTL safety net: 60s for tunnels, 5min for previews/sandboxes

### Why Same Process

- Tunnel broker's WebSocket map is **in-memory** — gateway needs direct access to relay frames
- Bun's HTTP proxy performance is sufficient (microseconds of CPU per request)
- Avoids IPC/Redis layer for tunnel data forwarding
- Can split out later if needed

---

## Part 4: URL Patterns (All Flattened Slugs)

| Resource | Pattern | Example |
|----------|---------|---------|
| Tunnel | `{adj}-{noun}-{num}.tunnel.dx.dev` | `happy-fox-42.tunnel.dx.dev` |
| Preview | `pr-{num}--{branch}--{site}.preview.dx.dev` | `pr-42--fix-auth-bug--myapp.preview.dx.dev` |
| Sandbox | `{slug}.sandbox.dx.dev` | `dev-nikhil-abc.sandbox.dx.dev` |
| Sandbox (port) | `{slug}-{port}.sandbox.dx.dev` | `dev-nikhil-abc-8080.sandbox.dx.dev` |
| Prod target | `{component}.{target}.dx.dev` | `api.prod.dx.dev` (IngressRoute, not gateway) |
| Custom domain | User FQDN | `app.example.com` (Traefik router, not gateway) |

All high-cardinality slugs use `--` as separator within a single DNS label. Never nested dots.

---

## Part 5: Data Model

### Three-layer pattern: Lifecycle → Runtime → Networking

```
Resource table (lifecycle: who, what, why)
    → deploymentTarget (runtime: where, how)
        → route (networking: domain → target)
```

### Preview Table (new)

**File**: `api/src/db/schema/fleet.ts` (add to existing file)

```typescript
export const preview = factoryFleet.table("preview", {
  previewId: text("preview_id").primaryKey().$defaultFn(() => newId("prv")),
  deploymentTargetId: text("deployment_target_id").notNull()
    .references(() => deploymentTarget.deploymentTargetId, { onDelete: "cascade" }),
  siteId: text("site_id").references(() => fleetSite.siteId, { onDelete: "set null" }),
  name: text("name").notNull(),                    // "PR #42 - fix-auth-bug"
  slug: text("slug").notNull(),                    // "pr-42--fix-auth-bug--myapp"
  sourceBranch: text("source_branch").notNull(),   // "fix-auth-bug"
  commitSha: text("commit_sha").notNull(),         // "a13f..."
  repo: text("repo").notNull(),                    // "github.com/org/myapp"
  prNumber: integer("pr_number"),                  // 42 (null for branch-only previews)
  ownerId: text("owner_id").notNull(),             // who created it
  authMode: text("auth_mode").notNull().default("team"),  // public | team | private
  runtimeClass: text("runtime_class").notNull().default("hot"),  // hot | warm | cold
  status: text("status").notNull().default("building"),
  statusMessage: text("status_message"),            // "Build failed: ..."
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("preview_slug_unique").on(t.slug),
  uniqueIndex("preview_deployment_target_unique").on(t.deploymentTargetId),
  index("preview_site_idx").on(t.siteId),
  index("preview_status_idx").on(t.status),
  index("preview_branch_idx").on(t.sourceBranch),
  check("preview_auth_mode_valid", sql`${t.authMode} IN ('public', 'team', 'private')`),
  check("preview_runtime_class_valid", sql`${t.runtimeClass} IN ('hot', 'warm', 'cold')`),
  check("preview_status_valid", sql`${t.status} IN ('building', 'deploying', 'active', 'inactive', 'expired', 'failed')`),
]);
```

### Existing Tables (no schema changes needed)

- **`route`** — already has `kind: "preview"`, `domain`, `targetService`, `status`, `expiresAt`, `metadata`. Used as-is.
- **`deploymentTarget`** — already has `kind: "sandbox"` (add `"preview"` to valid kinds). Has `namespace`, `clusterId`, `runtime`, `expiresAt`.
- **`tunnel`** — already complete for tunnel lifecycle. Add `mode` and `tcp_port` columns for TCP tunneling.
- **`sandbox`** — already complete, follows same three-layer pattern.

### Tunnel Schema Addition (for TCP tunneling)

```typescript
// Add to tunnel table:
mode: text("mode").notNull().default("http"),      // "http" | "tcp"
tcpPort: integer("tcp_port"),                      // assigned port for TCP tunnels
```

### How Each Resource Type Maps

| Resource | Lifecycle Table | deploymentTarget? | route kind |
|----------|----------------|-------------------|------------|
| Preview | `preview` | Yes (kind: "preview") | `preview` |
| Sandbox | `sandbox` | Yes (kind: "sandbox") | `sandbox` |
| Tunnel | `tunnel` | No (WS relay, no k8s workload) | `tunnel` |
| Prod/Staging | — | Yes (kind: "production"/"staging") | `ingress` |
| Custom domain | — | — | `custom_domain` |

---

## Part 6: Preview Lifecycle

### State Machine

```
PR opened / branch push
  → status: "building"
  → CI builds container image

Build complete
  → status: "deploying"
  → create deploymentTarget (kind: "preview", runtime: "kubernetes")
  → create route (kind: "preview", domain: "pr-42--fix-auth--myapp.preview.dx.dev")
  → deploy k8s workload
  → status: "active", runtimeClass: "hot"
  → warm gateway cache

2h idle (no requests, tracked via lastAccessedAt)
  → runtimeClass: "hot" → "warm"
  → scale k8s deployment to 0 replicas

24h idle
  → runtimeClass: "warm" → "cold"
  → delete k8s deployment entirely (keep preview + route records)

Request hits cold preview
  → gateway returns "Starting preview..." splash page (HTML with auto-refresh)
  → triggers redeploy
  → runtimeClass: "cold" → "hot"

New commit pushed to same branch
  → status: "building" (runtimeClass unchanged)
  → rebuild image, update deployment
  → status: "active"

expiresAt reached (e.g., 7 days after last commit)
  → status: "expired"
  → route status → "expired"
  → gateway returns 410 / branded "This preview has expired" page
  → destroy k8s deployment
  → keep DB records for audit trail

PR merged/closed
  → status: "inactive"
  → destroy deployment
  → delete route
```

### Cleanup Job

Periodic job (every 5 minutes):
1. Find previews where `expiresAt < now()` and `status = "active"` → mark expired
2. Find previews where `lastAccessedAt < now() - 2h` and `runtimeClass = "hot"` → scale to warm
3. Find previews where `lastAccessedAt < now() - 24h` and `runtimeClass = "warm"` → mark cold, delete deployment
4. Find previews where `status = "expired"` and `expiresAt < now() - 30d` → hard delete records

---

## Part 7: Tunnel Data Plane (Binary Framing)

### Protocol

**File**: `shared/src/tunnel-protocol.ts` (new)

Frame format (11-byte header):

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 1 | version | `0x01` |
| 1 | 1 | type | Frame type |
| 2 | 4 | streamId | uint32 BE |
| 6 | 1 | flags | FIN=0x01, RST=0x02, ACK=0x04 |
| 7 | 4 | length | uint32 BE, max 65536 |
| 11 | N | payload | Frame data |

Frame types: CONTROL (0x00), HTTP_REQ (0x01), HTTP_RES (0x02), DATA (0x03), TCP_CONNECT (0x04), TCP_CONNECTED (0x05), RST_STREAM (0x06), WINDOW_UPDATE (0x07), PING (0x08), PONG (0x09), GOAWAY (0x0A)

Stream IDs: even = server-initiated, odd = client-initiated, 0 = control.

Flow control: per-stream 256KB window, per-connection 1MB, WINDOW_UPDATE to grant.

### HTTP Tunnel Flow

1. Gateway identifies `kind: tunnel` from route lookup
2. Looks up WebSocket from tunnel broker's in-memory map
3. Allocates even streamId → sends `HTTP_REQ` frame (JSON headers) + `DATA` frames (body)
4. CLI client receives → forwards to `localhost:<port>` → sends `HTTP_RES` + `DATA` back
5. Gateway streams response to original caller
6. 30s timeout → RST_STREAM + 504

### TCP Tunnel Flow

1. Client registers `{ mode: "tcp", localAddr: "localhost:5432" }`
2. Broker allocates port from 10000-19999, opens TCP listener
3. Returns `{ tcpAddr: "tcp.tunnel.dx.dev:14532" }`
4. External TCP connection → allocate streamId → `TCP_CONNECT` → client opens local TCP → `TCP_CONNECTED` → bidirectional DATA piping

### Client Enhancements

**File**: `cli/src/lib/tunnel-client.ts` (modify)

- Handle binary frames: HTTP_REQ → local forward, TCP_CONNECT → local TCP
- Reconnection: exponential backoff (1s base, 30s max, jitter), subdomain reclaim via `{ reconnect: true }`

**File**: `cli/src/lib/backends/gateway-backend.ts` (implement stub)

- Use enhanced tunnel client for `dx dev --connect-to` TCP tunneling

---

## Part 8: Security

- **Gateway auth**: validate bearer token on tunnel WS upgrade (existing `authPlugin`)
- **Preview auth**: `authMode` field — `public` (open), `team` (require dx login), `private` (specific principals)
- **Rate limits**: 10 tunnel connections/principal/min, 100 concurrent streams/tunnel
- **Bandwidth**: configurable per-tunnel limit (default 100MB/min)

---

## Part 9: Scaling

### Gateway (stateless, horizontal)
- Run N replicas behind Traefik load balancer
- Each has LRU cache, invalidated via direct call (same process) or Redis pub/sub (multi-process)

### Tunnel Broker (stateful per connection)
- **Phase 1**: Node-affinity — route record stores `brokerNodeId`, gateway routes to correct node
- **Phase 2** (future): Redis pub/sub cross-node relay (needed at 100+ nodes)

---

## Implementation Phases

### Phase 1: Factory Gateway + Traefik Simplification (Week 1-2)
1. Create `factory-gateway.ts` — HTTP server with hostname parsing, cache lookup, reverse proxy
2. Simplify `traefik-sync.ts` — family-level wildcard routers for tunnel/preview/sandbox; keep per-route for custom_domain/ingress only
3. Set up wildcard DNS records + wildcard certs
4. Test: sandbox/preview URL → gateway → k8s pod (replace current per-route Traefik routing)

### Phase 2: Preview Data Model + Lifecycle (Week 2-3)
5. Add `preview` table to `api/src/db/schema/fleet.ts`
6. Add `"preview"` to deploymentTarget kind constraint
7. Create preview service: `createPreview()`, `updatePreview()`, `expirePreview()`
8. Preview cleanup job: hot→warm→cold→expired transitions
9. Gateway: serve "Starting..." / "Expired" pages for cold/expired previews
10. DB migration

### Phase 3: Tunnel Data Plane (Week 3-4)
11. Create `shared/src/tunnel-protocol.ts` — frame codec + types + unit tests
12. Enhance `tunnel-broker.ts` — binary framing, stream multiplexing
13. Wire gateway to forward tunnel requests through WS
14. Enhance `tunnel-client.ts` — HTTP_REQ forwarding to localhost
15. Add `mode`/`tcpPort` columns to tunnel table

### Phase 4: TCP Tunneling (Week 4-5)
16. Create `tunnel-tcp-proxy.ts` — port allocator, TCP listeners
17. Extend registration for `mode: "tcp"`
18. Client-side TCP_CONNECT handling
19. Implement `gateway-backend.ts` for `dx dev --connect-to`

### Phase 5: Production Hardening (Week 5-6)
20. Tunnel reconnection with exponential backoff + subdomain reclaim
21. Flow control (WINDOW_UPDATE)
22. Preview auth enforcement in gateway
23. Rate limiting + bandwidth limits
24. Health/metrics endpoint
25. Circuit breaker for degraded tunnels/previews
26. Cache invalidation for multi-replica gateway

---

## Critical Files

| Component | Path | Action |
|-----------|------|--------|
| **Factory Gateway** | `api/src/modules/infra/factory-gateway.ts` | Create |
| **Preview table** | `api/src/db/schema/fleet.ts` | Add preview table |
| **Preview service** | `api/src/services/preview/preview.service.ts` | Create |
| Frame protocol | `shared/src/tunnel-protocol.ts` | Create |
| Tunnel broker | `api/src/modules/infra/tunnel-broker.ts` | Enhance |
| TCP proxy | `api/src/modules/infra/tunnel-tcp-proxy.ts` | Create |
| Traefik sync | `api/src/modules/infra/traefik-sync.ts` | Simplify |
| Gateway service | `api/src/modules/infra/gateway.service.ts` | Add cache invalidation hooks |
| Gateway controller | `api/src/modules/infra/gateway.controller.ts` | Wire gateway startup |
| Tunnel client | `cli/src/lib/tunnel-client.ts` | Add binary frames |
| Gateway backend | `cli/src/lib/backends/gateway-backend.ts` | Implement |
| DB schema | `api/src/db/schema/gateway.ts` | Add tunnel mode/tcpPort |

## Verification

- **Gateway routing**: Request to `*.preview.dx.dev` → gateway resolves → proxies to k8s service
- **Preview lifecycle**: Create preview → access → let idle → verify warm/cold transitions → access cold → auto-warms
- **Preview expiry**: Set short TTL → verify 410 page after expiry
- **Tunnel E2E**: `dx tunnel 3000` → HTTP request to tunnel URL → response from localhost:3000
- **TCP tunnel**: Register TCP tunnel → connect to assigned port → data reaches local postgres
- **Scale test**: 1000 registered routes, verify gateway resolves all via cache (< 5ms p99)
- **Reconnection**: Kill tunnel WS → client reconnects → same subdomain works
- **Traefik simplification**: Verify only custom_domain/ingress routes generate per-route Traefik config
