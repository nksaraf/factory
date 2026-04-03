# Fix Seed Script: proxmox_vmid + lepton-59 + host cleanup

## Context

The Proxmox sync creates duplicates (46 new) and removes seeded records (45 removed) because the seed script doesn't set `proxmox_vmid` on VMs. The sync matches VMs by `proxmoxVmid + proxmoxClusterId` (`proxmox.adapter.ts:248-257`), so seeded VMs with NULL vmid are invisible to the matcher.

Additionally, lepton-59 is a bare metal server that gets incorrectly deleted by the sync's stale host removal.

## Data from old lepton DB (`postgres://...@192.168.2.89:5460/postgres`)

**Proxmox nodes (3)**: lepton-squirtle, lepton-charmander, lepton-pikachu
- lepton-bulbasaur does NOT exist — was never a real node
- lepton-59 does NOT exist as a node — it's bare metal

**VMID mapping (46 VMs)**:
| vmid | name | seed slug |
|------|------|-----------|
| 100 | app-smart-signal-fwa-stg | app-smart-signal-fwa-stg |
| 101 | k3s-master-2 | k3s-master-2 |
| 102 | docker-offline-install | docker-offline-install |
| 103 | UBUNTUGUI | ubuntugui |
| 104 | windows-samsung-sds | windows-samsung-sds |
| 105 | dev-vikrant-trafficure | dev-lepton-admin |
| 106 | app-trafficure-staging | app-trafficure-staging |
| 107 | dev-imran | dev-imran |
| 108 | smart-market | smart-market |
| 109 | dev-lepton-sm | dev-lepton-sm |
| 111 | Bharatnet-Mohali-vpn-jumpserver | bharatnet-mohali-vpn-jumpserver |
| 112 | sonu-postgres-offline | sonu-postgres-offline |
| 113 | postgres-offline | postgres-offline |
| 114 | service-graphhopper-australia-prod | service-graphhopper-australia-prod |
| 115 | factory-prod | factory-prod |
| 116 | Road-Selectio-Tool-Prod | dev-lepton-smartmarket |
| 117 | dev-ritvik-trafficure | dev-ritvik-trafficure |
| 118 | uat-lepton-smartmarket | uat-lepton-smartmarket |
| 119 | docker-27 | docker-27 |
| 120 | dockerhub | dockerhub |
| 121 | vpn-ather-sm-windows | vpn-ather-sm-windows |
| 122 | service-planet-windows-trial | service-planet-windows-trial |
| 123 | service-smart-tender-prod | service-smart-tender-prod |
| 124 | app-trafficure-prod | app-trafficure-prod |
| 125 | jenkins-dev | jenkins-dev |
| 126 | VM-CriticalReplicadbserverSmartopsSmartMarket | vm-criticalreplicadbserversmartopssmartmarket |
| 127 | cloud-controller | cloud-controller |
| 128 | dev-sonu | dev-sonu |
| 129 | trafficure-stress-test | trafficure-stress-test |
| 130 | service-zero-sync | service-zero-sync |
| 131 | service-zero-smart-tender | service-zero-smart-tender |
| 132 | backstage | backstage |
| 133 | app-smart-signal-sc2-stg | app-smart-signal-sc2-stg |
| 134 | backend-dev | backend-dev |
| 135 | app-smart-market-2-stg | app-smart-market-2-stg |
| 136 | gcp-bill-alert | gcp-bill-alert |
| 137 | dev-ritvik-2 | dev-ritvik-2 |
| 138 | bff-service | *(missing from seed — add it)* |
| 139 | workflow-engine | workflow-engine |
| 141 | platform | traffic-chennai |
| 144 | dev-vishwa-trafficure | dev-vishwa-trafficure |
| 146 | puru-vm | puru-vm |
| 147 | app-trafficure-dev-server | utc-app-trafficure |
| 148 | parth-vm | parth-vm |
| 149 | clickstack-lepton-api | clickstack-lepton-api |
| 150 | clickstack-lepton-api (dup name) | clickstack-lepton-api-2 |

**Non-Proxmox (no vmid)**: lepton-59 (bare metal), samsung-smart-market-prod (partner)

## Changes

### 1. Add `proxmoxVmid` to seed VMs — `.dx/scripts/seed-infra.ts`

- Add `vmid?: number` to the VMS array type
- Add `proxmoxVmid?: number` to `upsertVm` function signature + pass through to insert/update
- Hardcode all 46 VMIDs from the table above
- Add missing `bff-service` VM (vmid 138)

### 2. Remove lepton-59 host + VM, remove lepton-bulbasaur — `.dx/scripts/seed-infra.ts`

- **Remove** the `lepton-59` host entry (lines 311-319) — it's not a Proxmox node
- **Remove** the `lepton-59` VM entry (line 402, slug `lepton-59-vm`) — it's not a VM
- **Add** a new `lepton-baremetal` provider (`providerType: "baremetal"`, `providerKind: "internal"`)
- **Add** lepton-59 back as a host under the `lepton-baremetal` provider — this isolates it from Proxmox sync's stale removal
- lepton-bulbasaur is already not in the seed (never existed as a real node) — no action needed

### 3. Fix sync stale host removal — `api/src/adapters/proxmox.adapter.ts` (line 211-215)

Defensive fix: only delete hosts that were created by the Proxmox sync (identifiable by having `hostname` set — the sync sets it on line 181, the seed doesn't):

```typescript
// Only remove hosts that were created by Proxmox sync (have hostname set)
for (const [name, existing] of existingHostByName) {
  if (!seenNames.has(name) && existing.hostname != null) {
    await db.delete(host).where(eq(host.hostId, existing.hostId));
  }
}
```

## Files to modify

1. **`.dx/scripts/seed-infra.ts`** — Add vmids, fix host entries, add lepton-baremetal provider
2. **`api/src/adapters/proxmox.adapter.ts`** — Fix stale host removal guard (line 211-215)

## Verification

1. Start the DB: `docker compose up -d infra-postgres` + run migrations
2. Run `dx script seed-infra.ts` — should seed all VMs with proxmox_vmid populated
3. Verify: query `SELECT name, proxmox_vmid FROM factory_infra.vm WHERE proxmox_vmid IS NOT NULL` — should show 46 VMs with vmids
4. Verify: lepton-59 exists as a host under `lepton-baremetal` provider, not under `lepton`
5. Run Proxmox sync (if network available) — VMs should be UPDATED in-place, no duplicates created
6. Verify: lepton-59 survives the sync (not deleted by stale removal)
