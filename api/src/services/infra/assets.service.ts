import { sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { provider, cluster, vm, host } from "../../db/schema/infra";
import { getProvider } from "./provider.service";
import { getCluster } from "./cluster.service";
import { getVm } from "./vm.service";
import { getHost } from "./host.service";

export interface Asset {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: Date;
}

export async function listAssets(db: Database): Promise<Asset[]> {
  const result = await db.execute(sql`
    SELECT provider_id AS id, name, 'provider' AS type, status, created_at
    FROM factory_infra.provider
    UNION ALL
    SELECT cluster_id AS id, name, 'cluster' AS type, status, created_at
    FROM factory_infra.cluster
    UNION ALL
    SELECT vm_id AS id, name, 'vm' AS type, status, created_at
    FROM factory_infra.vm
    UNION ALL
    SELECT host_id AS id, name, 'host' AS type, status, created_at
    FROM factory_infra.host
    ORDER BY created_at DESC
  `);
  const { rows } = result as { rows: Asset[] };
  return rows;
}

export async function getAsset(db: Database, id: string) {
  const prefix = id.split("_")[0];
  switch (prefix) {
    case "prv":
      return getProvider(db, id);
    case "cls":
      return getCluster(db, id);
    case "vm":
      return getVm(db, id);
    case "host":
      return getHost(db, id);
    default:
      return null;
  }
}
