import { MapPin } from "lucide-react"

import type { ResourceDetail } from "../../types"

export default function ReportView({ resource }: { resource: ResourceDetail }) {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b bg-background px-4 py-2.5">
        <div className="flex gap-1.5">
          {["Preview", "Edit", "Export PDF"].map((t) => (
            <button
              key={t}
              className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer ${
                t === "Preview"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* PDF-style preview */}
      <div className="flex flex-1 justify-center overflow-auto bg-muted/30 p-6">
        <div className="w-full max-w-[640px] rounded-lg border bg-card p-10 shadow-sm">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
            SmartMarket Report
          </div>

          <h2 className="text-xl font-bold leading-tight text-foreground">
            {resource.name}
          </h2>
          <p className="mt-1 mb-6 text-xs text-muted-foreground">
            Generated March 20, 2026 &middot; v1.2
          </p>

          <div className="mb-6 border-t-2 border-foreground" />

          {/* Executive Summary */}
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Executive Summary
          </h3>
          <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
            Analysis of 12 candidate sites across Western Mumbai reveals 4
            locations with Market Opportunity Scores above 80, indicating strong
            expansion potential. The top candidate (Andheri West, MOS: 91) shows
            high demographic density, moderate competition, and a penetration
            gap of 34%.
          </p>

          {/* Key Findings */}
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Key Findings
          </h3>
          <div className="mb-4 grid grid-cols-2 gap-3">
            {[
              { label: "Sites Analyzed", value: "12" },
              { label: "High Potential (MOS > 80)", value: "4" },
              { label: "Avg Predicted Revenue", value: "\u20B91.8L/mo" },
              { label: "Cannibalization Risk", value: "Low (< 8%)" },
            ].map((k) => (
              <div key={k.label} className="rounded-lg bg-muted/40 p-3">
                <div className="text-[11px] text-muted-foreground">
                  {k.label}
                </div>
                <div className="mt-0.5 text-lg font-bold text-foreground">
                  {k.value}
                </div>
              </div>
            ))}
          </div>

          {/* Embedded map placeholder */}
          <div className="mb-4 flex h-[120px] items-center justify-center rounded-lg bg-muted/40 text-[13px] text-muted-foreground">
            <MapPin size={16} className="mr-1.5" /> Embedded map visualization
          </div>

          {/* Conclusion */}
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Revenue forecasting indicates the top 4 sites would generate a
            combined &#x20B9;7.2L monthly within 6 months of launch, with
            minimal cannibalization impact on existing locations in the T-West
            territory cluster.
          </p>
        </div>
      </div>
    </div>
  )
}
