import type { ActivityItem } from "../data/use-workspace-activity"
import type { Block, Resource, ResourceDetail } from "../types"

const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86_400_000).toISOString()
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString()
const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()

export const MOCK_RESOURCES: Resource[] = [
  // ── Root folders ──
  {
    id: "res_mumbai",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Mumbai Expansion",
    resourceType: "folder",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_distribution",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Distribution Network",
    resourceType: "folder",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_data_ontology",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Data & Ontology",
    resourceType: "folder",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Mumbai Expansion children ──
  {
    id: "res_m1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Outlet Coverage Map",
    resourceType: "map",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_m2",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Competitor Density",
    resourceType: "map",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_db1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Regional Performance",
    resourceType: "dashboard",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_r1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Site Readiness Report",
    resourceType: "report",
    sortKey: "a3",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  {
    id: "res_agent1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Site Selection Analysis",
    resourceType: "agent_session",
    sortKey: "a5",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_agent2",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Route Optimization Chat",
    resourceType: "agent_session",
    sortKey: "a4",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_agent3",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Data Quality Investigation",
    resourceType: "agent_session",
    sortKey: "a3",
    createdBy: "user_1",
    createdAt: yesterday,
    updatedAt: yesterday,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_agent4",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Competitor Gap Analysis",
    resourceType: "agent_session",
    sortKey: "a6",
    createdBy: "user_1",
    createdAt: twoDaysAgo,
    updatedAt: twoDaysAgo,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_agent5",
    workspaceId: "ws_demo",
    parentId: null,
    name: "SKU Assortment Recommendations",
    resourceType: "agent_session",
    sortKey: "a3",
    createdBy: "user_1",
    createdAt: fourDaysAgo,
    updatedAt: fourDaysAgo,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_agent6",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Monthly KPI Summary",
    resourceType: "agent_session",
    sortKey: "a4",
    createdBy: "user_1",
    createdAt: tenDaysAgo,
    updatedAt: tenDaysAgo,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Mumbai > Scoring Pipelines (nested folder) ──
  {
    id: "res_scoring",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Scoring Pipelines",
    resourceType: "folder",
    sortKey: "a4",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_p1",
    workspaceId: "ws_demo",
    parentId: "res_scoring",
    name: "MOS Scoring Pipeline",
    resourceType: "pipeline",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_p2",
    workspaceId: "ws_demo",
    parentId: "res_scoring",
    name: "Revenue Forecast ETL",
    resourceType: "pipeline",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Distribution Network children ──
  {
    id: "res_m3",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Beat Routes Map",
    resourceType: "map",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_db2",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Route Efficiency Dashboard",
    resourceType: "dashboard",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_pr1",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "New Outlet Onboarding",
    resourceType: "process",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_pr2",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Beat Reassignment Flow",
    resourceType: "process",
    sortKey: "a3",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Data & Ontology children ──
  {
    id: "res_ds1",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Outlet Locations",
    resourceType: "dataset",
    sortKey: "a00",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_ds2",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Sales Transactions",
    resourceType: "dataset",
    sortKey: "a01",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_o1",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Workspace Ontology",
    resourceType: "ontology",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_p3",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Nightly Ingestion",
    resourceType: "pipeline",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_rpt2",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Data Quality Report",
    resourceType: "report",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
]

// ── Mock blocks for dataset resources ──

function makeBlock(
  id: string,
  resourceId: string,
  blockType: string,
  data: Record<string, unknown>,
  sortKey = "a0"
): Block {
  return {
    id,
    workspaceId: "ws_demo",
    resourceId,
    parentId: null,
    path: "/",
    depth: 0,
    blockType,
    schemaVersion: 1,
    data,
    sortKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Activity feed ───────────────────────────────────────────────────────────

const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString()
const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString()
const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()

export const MOCK_ACTIVITY_FEED: ActivityItem[] = [
  {
    id: "act_1",
    type: "resource_updated",
    actorName: "Priya Sharma",
    resourceName: "Outlet Coverage Map",
    resourceType: "map",
    timestamp: threeHoursAgo,
    description: "updated",
  },
  {
    id: "act_2",
    type: "resource_created",
    actorName: "Rahul Verma",
    resourceName: "MOS Scoring Pipeline",
    resourceType: "pipeline",
    timestamp: sixHoursAgo,
    description: "created",
  },
  {
    id: "act_3",
    type: "agent_session_completed",
    actorName: "AI Agent",
    resourceName: "Site Selection Analysis",
    resourceType: "agent_session",
    timestamp: yesterday,
    description: "completed session",
  },
  {
    id: "act_4",
    type: "resource_updated",
    actorName: "Priya Sharma",
    resourceName: "Regional Performance",
    resourceType: "dashboard",
    timestamp: yesterday,
    description: "updated",
  },
  {
    id: "act_5",
    type: "resource_created",
    actorName: "Amit Patel",
    resourceName: "Site Readiness Report",
    resourceType: "report",
    timestamp: twoDaysAgo,
    description: "published",
  },
  {
    id: "act_6",
    type: "resource_updated",
    actorName: "Rahul Verma",
    resourceName: "Beat Routes Map",
    resourceType: "map",
    timestamp: threeDaysAgo,
    description: "updated",
  },
  {
    id: "act_7",
    type: "resource_created",
    actorName: "Priya Sharma",
    resourceName: "Product Taxonomy",
    resourceType: "ontology",
    timestamp: fourDaysAgo,
    description: "created",
  },
  {
    id: "act_8",
    type: "resource_updated",
    actorName: "Amit Patel",
    resourceName: "Sales by Region",
    resourceType: "dataset",
    timestamp: tenDaysAgo,
    description: "updated",
  },
]

export const MOCK_DATASET_BLOCKS: Record<string, Block[]> = {
  // Outlet Locations — vector dataset with geometry
  res_ds1: [
    makeBlock("blk_ds1_meta", "res_ds1", "dataset_meta", {
      kind: "vector",
      description:
        "Retail outlet locations across Mumbai metro area with footfall and revenue metrics.",
      rowCount: 2847,
      source: { type: "parquet" },
      bounds: [72.7757, 18.8928, 72.9868, 19.2707],
    }),
    makeBlock(
      "blk_ds1_a1",
      "res_ds1",
      "dataset_attribute",
      {
        name: "outlet_id",
        type: "string",
        description: "Unique outlet identifier",
      },
      "a0"
    ),
    makeBlock(
      "blk_ds1_a2",
      "res_ds1",
      "dataset_attribute",
      {
        name: "name",
        type: "string",
        description: "Outlet display name",
      },
      "a1"
    ),
    makeBlock(
      "blk_ds1_a3",
      "res_ds1",
      "dataset_attribute",
      {
        name: "latitude",
        type: "double",
        description: "Latitude coordinate",
      },
      "a2"
    ),
    makeBlock(
      "blk_ds1_a4",
      "res_ds1",
      "dataset_attribute",
      {
        name: "longitude",
        type: "double",
        description: "Longitude coordinate",
      },
      "a3"
    ),
    makeBlock(
      "blk_ds1_a5",
      "res_ds1",
      "dataset_attribute",
      {
        name: "monthly_revenue",
        type: "double",
        description: "Average monthly revenue in INR",
      },
      "a4"
    ),
    makeBlock(
      "blk_ds1_a6",
      "res_ds1",
      "dataset_attribute",
      {
        name: "footfall",
        type: "int32",
        description: "Average daily footfall",
      },
      "a5"
    ),
    makeBlock(
      "blk_ds1_a7",
      "res_ds1",
      "dataset_attribute",
      {
        name: "geometry",
        type: "geometry",
        description: "Point geometry (WGS84)",
      },
      "a6"
    ),
    // Sample rows
    makeBlock(
      "blk_ds1_r1",
      "res_ds1",
      "dataset_row",
      {
        outlet_id: "OUT-001",
        name: "Metro Mart Andheri",
        latitude: 19.1197,
        longitude: 72.8464,
        monthly_revenue: 425000,
        footfall: 312,
        geometry: "POINT(72.8464 19.1197)",
      },
      "b0"
    ),
    makeBlock(
      "blk_ds1_r2",
      "res_ds1",
      "dataset_row",
      {
        outlet_id: "OUT-002",
        name: "Super Store Bandra",
        latitude: 19.0596,
        longitude: 72.8295,
        monthly_revenue: 680000,
        footfall: 498,
        geometry: "POINT(72.8295 19.0596)",
      },
      "b1"
    ),
    makeBlock(
      "blk_ds1_r3",
      "res_ds1",
      "dataset_row",
      {
        outlet_id: "OUT-003",
        name: "Quick Buy Dadar",
        latitude: 19.0178,
        longitude: 72.8478,
        monthly_revenue: 312000,
        footfall: 245,
        geometry: "POINT(72.8478 19.0178)",
      },
      "b2"
    ),
    makeBlock(
      "blk_ds1_r4",
      "res_ds1",
      "dataset_row",
      {
        outlet_id: "OUT-004",
        name: "Fresh Bazaar Kurla",
        latitude: 19.0726,
        longitude: 72.8793,
        monthly_revenue: 198000,
        footfall: 167,
        geometry: "POINT(72.8793 19.0726)",
      },
      "b3"
    ),
    makeBlock(
      "blk_ds1_r5",
      "res_ds1",
      "dataset_row",
      {
        outlet_id: "OUT-005",
        name: "City Essentials Powai",
        latitude: 19.1176,
        longitude: 72.906,
        monthly_revenue: 540000,
        footfall: 389,
        geometry: "POINT(72.9060 19.1176)",
      },
      "b4"
    ),
  ],

  // Sales Transactions — tabular dataset
  res_ds2: [
    makeBlock("blk_ds2_meta", "res_ds2", "dataset_meta", {
      kind: "table",
      description:
        "Daily aggregated sales transactions from all Mumbai outlets.",
      rowCount: 18432,
      source: { type: "parquet" },
    }),
    makeBlock(
      "blk_ds2_a1",
      "res_ds2",
      "dataset_attribute",
      {
        name: "transaction_date",
        type: "date",
        description: "Date of transaction",
      },
      "a0"
    ),
    makeBlock(
      "blk_ds2_a2",
      "res_ds2",
      "dataset_attribute",
      {
        name: "outlet_id",
        type: "string",
        description: "Outlet identifier",
      },
      "a1"
    ),
    makeBlock(
      "blk_ds2_a3",
      "res_ds2",
      "dataset_attribute",
      {
        name: "product_category",
        type: "string",
        description: "Product category name",
      },
      "a2"
    ),
    makeBlock(
      "blk_ds2_a4",
      "res_ds2",
      "dataset_attribute",
      {
        name: "quantity",
        type: "int32",
        description: "Units sold",
      },
      "a3"
    ),
    makeBlock(
      "blk_ds2_a5",
      "res_ds2",
      "dataset_attribute",
      {
        name: "amount",
        type: "double",
        description: "Total sale amount in INR",
      },
      "a4"
    ),
    makeBlock(
      "blk_ds2_a6",
      "res_ds2",
      "dataset_attribute",
      {
        name: "payment_method",
        type: "string",
        description: "Payment method used",
      },
      "a5"
    ),
    // Sample rows
    makeBlock(
      "blk_ds2_r1",
      "res_ds2",
      "dataset_row",
      {
        transaction_date: "2026-03-20",
        outlet_id: "OUT-001",
        product_category: "Beverages",
        quantity: 48,
        amount: 14400,
        payment_method: "UPI",
      },
      "b0"
    ),
    makeBlock(
      "blk_ds2_r2",
      "res_ds2",
      "dataset_row",
      {
        transaction_date: "2026-03-20",
        outlet_id: "OUT-002",
        product_category: "Snacks",
        quantity: 120,
        amount: 36000,
        payment_method: "Card",
      },
      "b1"
    ),
    makeBlock(
      "blk_ds2_r3",
      "res_ds2",
      "dataset_row",
      {
        transaction_date: "2026-03-19",
        outlet_id: "OUT-003",
        product_category: "Dairy",
        quantity: 85,
        amount: 21250,
        payment_method: "Cash",
      },
      "b2"
    ),
  ],

  // ── Dashboard: Regional Performance (res_db1) ──
  res_db1: [
    // KPI cards (row 1)
    makeBlock(
      "blk_db1_kpi1",
      "res_db1",
      "dashboard_kpi",
      {
        title: "Total Revenue",
        value: 12450000,
        unit: "INR",
        change: 12.4,
        changeLabel: "vs last month",
        icon: "💰",
      },
      "a0"
    ),
    makeBlock(
      "blk_db1_kpi2",
      "res_db1",
      "dashboard_kpi",
      {
        title: "Active Outlets",
        value: 2847,
        change: 3.2,
        changeLabel: "vs last month",
        icon: "🏪",
      },
      "a1"
    ),
    makeBlock(
      "blk_db1_kpi3",
      "res_db1",
      "dashboard_kpi",
      {
        title: "Avg. Footfall",
        value: 322,
        unit: "/day",
        change: -1.8,
        changeLabel: "vs last month",
        icon: "👥",
      },
      "a2"
    ),
    makeBlock(
      "blk_db1_kpi4",
      "res_db1",
      "dashboard_kpi",
      {
        title: "Coverage Area",
        value: "48.2",
        unit: "km²",
        change: 5.1,
        changeLabel: "vs last quarter",
        icon: "📍",
      },
      "a3"
    ),

    // Bar chart — revenue by zone (row 2, spans 2 cols)
    makeBlock(
      "blk_db1_bar",
      "res_db1",
      "dashboard_bar_chart",
      {
        title: "Revenue by Zone (₹ Lakhs)",
        labels: ["Andheri", "Bandra", "Dadar", "Kurla", "Powai", "Thane"],
        series: [
          {
            name: "Current Month",
            values: [42.5, 68.0, 31.2, 19.8, 54.0, 28.7],
            color: "#3b82f6",
          },
          {
            name: "Previous Month",
            values: [38.1, 62.3, 33.5, 17.2, 49.8, 25.1],
            color: "#94a3b8",
          },
        ],
      },
      "b0"
    ),

    // Line chart — trend (row 2, spans 2 cols)
    makeBlock(
      "blk_db1_line",
      "res_db1",
      "dashboard_line_chart",
      {
        title: "Monthly Revenue Trend (₹ Lakhs)",
        labels: ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"],
        series: [
          {
            name: "Revenue",
            values: [98.2, 105.4, 112.8, 108.3, 118.6, 124.5],
            color: "#3b82f6",
          },
          {
            name: "Target",
            values: [100, 105, 110, 115, 120, 125],
            color: "#f59e0b",
          },
        ],
      },
      "b1"
    ),

    // Stat grid — distribution metrics (row 3, full width)
    makeBlock(
      "blk_db1_stats",
      "res_db1",
      "dashboard_stat_grid",
      {
        title: "Distribution Metrics",
        stats: [
          { label: "Total Beats", value: 186 },
          { label: "Avg. Beat Size", value: "15.3 outlets" },
          { label: "Fill Rate", value: "94.2%", color: "#10b981" },
          { label: "Returns", value: "2.1%", color: "#ef4444" },
          { label: "New Outlets (MTD)", value: 23, color: "#3b82f6" },
          { label: "Churned Outlets", value: 8, color: "#ef4444" },
          { label: "SKU Penetration", value: "67%", color: "#f59e0b" },
          { label: "On-time Delivery", value: "91.8%", color: "#10b981" },
        ],
      },
      "c0"
    ),

    // Data table — top outlets (row 4, full width)
    makeBlock(
      "blk_db1_table",
      "res_db1",
      "dashboard_table",
      {
        title: "Top Performing Outlets",
        columns: [
          { key: "rank", label: "#", align: "center" },
          { key: "name", label: "Outlet" },
          { key: "zone", label: "Zone" },
          { key: "revenue", label: "Revenue (₹)", align: "right" },
          { key: "footfall", label: "Footfall", align: "right" },
          { key: "growth", label: "Growth", align: "right" },
        ],
        rows: [
          {
            rank: 1,
            name: "Super Store Bandra",
            zone: "Bandra",
            revenue: "6,80,000",
            footfall: 498,
            growth: "+14.2%",
          },
          {
            rank: 2,
            name: "City Essentials Powai",
            zone: "Powai",
            revenue: "5,40,000",
            footfall: 389,
            growth: "+8.5%",
          },
          {
            rank: 3,
            name: "Metro Mart Andheri",
            zone: "Andheri",
            revenue: "4,25,000",
            footfall: 312,
            growth: "+11.6%",
          },
          {
            rank: 4,
            name: "Quick Buy Dadar",
            zone: "Dadar",
            revenue: "3,12,000",
            footfall: 245,
            growth: "-6.8%",
          },
          {
            rank: 5,
            name: "Fresh Bazaar Kurla",
            zone: "Kurla",
            revenue: "1,98,000",
            footfall: 167,
            growth: "+15.1%",
          },
        ],
      },
      "d0"
    ),
  ],

  // ── Dashboard: Route Efficiency (res_db2) ──
  res_db2: [
    // Text block — summary
    makeBlock(
      "blk_db2_text",
      "res_db2",
      "dashboard_text",
      {
        title: "Route Efficiency Summary",
        content:
          "Overall route efficiency has improved 4.3% this quarter. Three beats in the Thane zone are flagged for optimization — average delivery time exceeds 45 minutes.",
        variant: "info",
      },
      "a0"
    ),

    // KPI cards
    makeBlock(
      "blk_db2_kpi1",
      "res_db2",
      "dashboard_kpi",
      {
        title: "Avg. Delivery Time",
        value: "38",
        unit: "min",
        change: -4.3,
        changeLabel: "vs last quarter",
        icon: "⏱️",
      },
      "b0"
    ),
    makeBlock(
      "blk_db2_kpi2",
      "res_db2",
      "dashboard_kpi",
      {
        title: "Routes Optimized",
        value: 142,
        change: 8.7,
        changeLabel: "vs last quarter",
        icon: "🛣️",
      },
      "b1"
    ),
    makeBlock(
      "blk_db2_kpi3",
      "res_db2",
      "dashboard_kpi",
      {
        title: "Fuel Cost Savings",
        value: 285000,
        unit: "INR",
        change: 15.2,
        changeLabel: "vs last quarter",
        icon: "⛽",
      },
      "b2"
    ),
    makeBlock(
      "blk_db2_kpi4",
      "res_db2",
      "dashboard_kpi",
      {
        title: "On-time Rate",
        value: "91.8",
        unit: "%",
        change: 2.1,
        changeLabel: "vs last quarter",
        icon: "✅",
      },
      "b3"
    ),

    // Bar chart — delivery time by zone
    makeBlock(
      "blk_db2_bar",
      "res_db2",
      "dashboard_bar_chart",
      {
        title: "Avg. Delivery Time by Zone (min)",
        labels: ["Andheri", "Bandra", "Dadar", "Kurla", "Powai", "Thane"],
        series: [
          {
            name: "Current",
            values: [32, 28, 35, 41, 36, 52],
            color: "#3b82f6",
          },
          {
            name: "Target",
            values: [30, 30, 30, 35, 35, 40],
            color: "#f59e0b",
          },
        ],
      },
      "c0"
    ),

    // Line chart — weekly trend
    makeBlock(
      "blk_db2_line",
      "res_db2",
      "dashboard_line_chart",
      {
        title: "Weekly Route Efficiency Score",
        labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
        series: [
          {
            name: "Efficiency",
            values: [78, 80, 79, 83, 85, 84, 87, 88],
            color: "#10b981",
          },
          {
            name: "Baseline",
            values: [80, 80, 80, 80, 80, 80, 80, 80],
            color: "#94a3b8",
          },
        ],
      },
      "c1"
    ),

    // Table — flagged routes
    makeBlock(
      "blk_db2_table",
      "res_db2",
      "dashboard_table",
      {
        title: "Flagged Routes — Needs Optimization",
        columns: [
          { key: "route", label: "Route" },
          { key: "zone", label: "Zone" },
          { key: "outlets", label: "Outlets", align: "right" },
          { key: "avgTime", label: "Avg. Time", align: "right" },
          { key: "target", label: "Target", align: "right" },
          { key: "status", label: "Status" },
        ],
        rows: [
          {
            route: "THN-07",
            zone: "Thane",
            outlets: 18,
            avgTime: "58 min",
            target: "40 min",
            status: "Critical",
          },
          {
            route: "THN-03",
            zone: "Thane",
            outlets: 14,
            avgTime: "52 min",
            target: "40 min",
            status: "Warning",
          },
          {
            route: "KRL-12",
            zone: "Kurla",
            outlets: 22,
            avgTime: "47 min",
            target: "35 min",
            status: "Warning",
          },
          {
            route: "THN-11",
            zone: "Thane",
            outlets: 16,
            avgTime: "46 min",
            target: "40 min",
            status: "Warning",
          },
        ],
      },
      "d0"
    ),
  ],

  // ── Agent Session: Site Selection Analysis (res_agent1) ──
  res_agent1: [
    makeBlock("blk_ag1_meta", "res_agent1", "agent_session_meta", {
      chatId: "chat_agent1",
      agentName: "Site Selection Agent",
      model: "claude-sonnet-4-5-20250514",
      status: "completed",
      totalTokens: 12480,
      startedAt: "2026-03-21T09:15:00Z",
      completedAt: "2026-03-21T09:18:42Z",
      systemPrompt:
        "You are a site selection analyst for retail expansion in Mumbai. You have access to outlet data, demographic data, and competitor maps.",
    }),
    makeBlock(
      "blk_ag1_m1",
      "res_agent1",
      "agent_message",
      {
        role: "user",
        content:
          "Analyze the top 3 areas in Mumbai with the highest potential for new outlet placement, considering footfall, competitor density, and revenue per sq km.",
        timestamp: "2026-03-21T09:15:00Z",
      },
      "a0"
    ),
    makeBlock(
      "blk_ag1_m2",
      "res_agent1",
      "agent_message",
      {
        role: "assistant",
        content:
          "I'll analyze the Mumbai metro area for optimal new outlet placement. Let me pull the relevant datasets and run the analysis.",
        timestamp: "2026-03-21T09:15:12Z",
        toolCalls: [
          { name: "query_dataset", status: "success" },
          { name: "spatial_analysis", status: "success" },
        ],
      },
      "a1"
    ),
    makeBlock(
      "blk_ag1_m3",
      "res_agent1",
      "agent_message",
      {
        role: "assistant",
        content: `Based on my analysis of 2,847 existing outlets, competitor locations, and demographic data, here are the top 3 areas:

**1. Malad West** — Score: 92/100
- Current outlet density: 3.2/km² (below avg 5.1)
- Avg. daily footfall in area: 48,000
- Competitor presence: Low (2 major chains)
- Estimated monthly revenue potential: ₹7.2L

**2. Ghatkopar East** — Score: 87/100
- Current outlet density: 2.8/km²
- Avg. daily footfall: 52,000
- Competitor presence: Medium (4 chains)
- Estimated monthly revenue potential: ₹6.1L

**3. Borivali West** — Score: 84/100
- Current outlet density: 4.1/km²
- Avg. daily footfall: 39,000
- Competitor presence: Low (1 major chain)
- Estimated monthly revenue potential: ₹5.8L

All three areas show strong residential growth and are underserved relative to population density.`,
        timestamp: "2026-03-21T09:16:35Z",
        toolCalls: [{ name: "generate_report", status: "success" }],
      },
      "a2"
    ),
    makeBlock(
      "blk_ag1_m4",
      "res_agent1",
      "agent_message",
      {
        role: "user",
        content:
          "Can you also check what the lease costs look like in Malad West and suggest specific micro-locations?",
        timestamp: "2026-03-21T09:17:10Z",
      },
      "a3"
    ),
    makeBlock(
      "blk_ag1_m5",
      "res_agent1",
      "agent_message",
      {
        role: "assistant",
        content: `For Malad West, I've identified 3 promising micro-locations based on foot traffic patterns and commercial real estate availability:

1. **SV Road, near Malad Station** — High footfall corridor
   - Estimated lease: ₹1.2–1.5L/month (800 sq ft)
   - Walk-in traffic: ~2,200/day

2. **Evershine Nagar, Link Road** — Residential hub
   - Estimated lease: ₹85K–1.1L/month (600 sq ft)
   - Walk-in traffic: ~1,400/day

3. **Orlem, near Marve Road junction** — Growing commercial area
   - Estimated lease: ₹70K–90K/month (700 sq ft)
   - Walk-in traffic: ~1,100/day

I'd recommend prioritizing Location 1 for maximum revenue or Location 3 for the best ROI given lower lease costs.`,
        timestamp: "2026-03-21T09:18:42Z",
        toolCalls: [
          { name: "real_estate_lookup", status: "success" },
          { name: "footfall_heatmap", status: "success" },
        ],
      },
      "a4"
    ),
  ],

  // ── Agent Session: Route Optimization Chat (res_agent2) ──
  res_agent2: [
    makeBlock("blk_ag2_meta", "res_agent2", "agent_session_meta", {
      chatId: "chat_agent2",
      agentName: "Route Optimizer",
      model: "claude-sonnet-4-5-20250514",
      status: "active",
      totalTokens: 8240,
      startedAt: "2026-03-21T10:30:00Z",
      systemPrompt:
        "You are a logistics optimization agent. Help optimize delivery routes for the Mumbai distribution network.",
    }),
    makeBlock(
      "blk_ag2_m1",
      "res_agent2",
      "agent_message",
      {
        role: "system",
        content:
          "Session started — Route Optimizer connected to distribution network data.",
        timestamp: "2026-03-21T10:30:00Z",
      },
      "a0"
    ),
    makeBlock(
      "blk_ag2_m2",
      "res_agent2",
      "agent_message",
      {
        role: "user",
        content:
          "The Thane zone routes THN-07 and THN-03 have been flagged for exceeding delivery time targets. Can you suggest optimizations?",
        timestamp: "2026-03-21T10:30:15Z",
      },
      "a1"
    ),
    makeBlock(
      "blk_ag2_m3",
      "res_agent2",
      "agent_message",
      {
        role: "assistant",
        content: `Analyzing routes THN-07 and THN-03...

**THN-07** (18 outlets, avg 58 min vs 40 min target):
The main bottleneck is the Ghodbunder Road segment between stops 8–14. Traffic peaks at 10:30 AM on this stretch.

Suggested fixes:
- Split into two sub-routes: THN-07A (stops 1–9) and THN-07B (stops 10–18)
- Shift THN-07B start time from 9:00 AM to 7:30 AM to avoid peak traffic
- Estimated new avg: 34 min per sub-route

**THN-03** (14 outlets, avg 52 min vs 40 min target):
Stops 5 and 6 are 4.2 km apart with no highway access — this single leg takes 18 min.

Suggested fixes:
- Reassign stop 6 to route THN-04 (which passes within 800m)
- Re-sequence stops 7–14 using nearest-neighbor ordering
- Estimated new avg: 38 min`,
        timestamp: "2026-03-21T10:31:45Z",
        toolCalls: [
          { name: "route_analysis", status: "success" },
          { name: "traffic_patterns", status: "success" },
          { name: "route_optimizer", status: "pending" },
        ],
      },
      "a2"
    ),
  ],

  // ── Agent Session: Data Quality Investigation (res_agent3) ──
  res_agent3: [
    makeBlock("blk_ag3_meta", "res_agent3", "agent_session_meta", {
      chatId: "chat_agent3",
      agentName: "Data Quality Agent",
      model: "claude-sonnet-4-5-20250514",
      status: "completed",
      totalTokens: 6120,
      startedAt: yesterday,
      completedAt: yesterday,
      systemPrompt:
        "You are a data quality analyst. Help investigate and resolve data quality issues in the workspace datasets.",
    }),
    makeBlock(
      "blk_ag3_m1",
      "res_agent3",
      "agent_message",
      {
        role: "user",
        content:
          "I noticed some outlet records have missing latitude/longitude values. Can you identify which ones and suggest fixes?",
        timestamp: yesterday,
      },
      "a0"
    ),
    makeBlock(
      "blk_ag3_m2",
      "res_agent3",
      "agent_message",
      {
        role: "assistant",
        content:
          "I found 23 outlet records with null or zero coordinates. Most are recently onboarded outlets in the Thane expansion zone. I can geocode them from their addresses — shall I proceed?",
        timestamp: yesterday,
        toolCalls: [{ name: "query_dataset", status: "success" }],
      },
      "a1"
    ),
  ],

  // ── Agent Session: Competitor Gap Analysis (res_agent4) ──
  res_agent4: [
    makeBlock("blk_ag4_meta", "res_agent4", "agent_session_meta", {
      chatId: "chat_agent4",
      agentName: "Market Analyst",
      model: "claude-sonnet-4-5-20250514",
      status: "completed",
      totalTokens: 9850,
      startedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
    }),
    makeBlock(
      "blk_ag4_m1",
      "res_agent4",
      "agent_message",
      {
        role: "user",
        content:
          "Compare our outlet density against top 3 competitors in the Bandra-Kurla corridor.",
        timestamp: twoDaysAgo,
      },
      "a0"
    ),
    makeBlock(
      "blk_ag4_m2",
      "res_agent4",
      "agent_message",
      {
        role: "assistant",
        content:
          "In the BKC corridor (5km radius), we have 12 outlets vs DMart (8), Reliance Fresh (15), and BigBasket dark stores (6). Our density is competitive but Reliance has 25% more coverage in residential pockets.",
        timestamp: twoDaysAgo,
        toolCalls: [
          { name: "competitor_data", status: "success" },
          { name: "spatial_analysis", status: "success" },
        ],
      },
      "a1"
    ),
  ],

  // ── Agent Session: SKU Assortment (res_agent5) ──
  res_agent5: [
    makeBlock("blk_ag5_meta", "res_agent5", "agent_session_meta", {
      chatId: "chat_agent5",
      agentName: "Assortment Planner",
      model: "claude-sonnet-4-5-20250514",
      status: "completed",
      totalTokens: 4200,
      startedAt: fourDaysAgo,
      completedAt: fourDaysAgo,
    }),
    makeBlock(
      "blk_ag5_m1",
      "res_agent5",
      "agent_message",
      {
        role: "user",
        content:
          "Which product categories are underperforming at Powai outlets?",
        timestamp: fourDaysAgo,
      },
      "a0"
    ),
    makeBlock(
      "blk_ag5_m2",
      "res_agent5",
      "agent_message",
      {
        role: "assistant",
        content:
          "Dairy and personal care are 30% below zone average at Powai outlets. Likely due to proximity to D-Mart which runs heavy discounts on these categories. Consider switching shelf space to premium snacks and beverages where we outperform.",
        timestamp: fourDaysAgo,
        toolCalls: [{ name: "sales_analysis", status: "success" }],
      },
      "a1"
    ),
  ],

  // ── Agent Session: Monthly KPI Summary (res_agent6) ──
  res_agent6: [
    makeBlock("blk_ag6_meta", "res_agent6", "agent_session_meta", {
      chatId: "chat_agent6",
      agentName: "KPI Reporter",
      model: "claude-sonnet-4-5-20250514",
      status: "completed",
      totalTokens: 3100,
      startedAt: tenDaysAgo,
      completedAt: tenDaysAgo,
    }),
    makeBlock(
      "blk_ag6_m1",
      "res_agent6",
      "agent_message",
      {
        role: "user",
        content: "Generate the February KPI summary for the Mumbai region.",
        timestamp: tenDaysAgo,
      },
      "a0"
    ),
    makeBlock(
      "blk_ag6_m2",
      "res_agent6",
      "agent_message",
      {
        role: "assistant",
        content:
          "February KPI Summary — Mumbai Region: Revenue ₹1.18Cr (+8.2% MoM), Active Outlets 2,812 (+23 net), Avg Footfall 318/day (-1.2%), Fill Rate 93.8%. Three zones exceeded targets: Andheri, Bandra, Powai.",
        timestamp: tenDaysAgo,
        toolCalls: [
          { name: "aggregate_metrics", status: "success" },
          { name: "generate_report", status: "success" },
        ],
      },
      "a1"
    ),
  ],
}
