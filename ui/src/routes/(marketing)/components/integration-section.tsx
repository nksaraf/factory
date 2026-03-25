import { Button } from "@rio.js/ui/button"
import { Icon, Icons } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

const integrations = [
  "Salesforce",
  "SAP",
  "Google Maps",
  "ERP",
  "Custom API",
]

export function IntegrationSection() {
  return (
    <section className="relative w-full bg-gradient-to-b from-scale-100 to-teal-50 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-4 text-4xl font-bold text-scale-1200 lg:text-5xl">
            Connects to Your Existing Stack
          </h2>
          <p className="mb-12 text-lg text-scale-1000">
            No rip-and-replace. SmartMarket integrates seamlessly with your
            CRM, ERP, DMS, and existing data infrastructure to enrich what you
            already have.
          </p>

          <div className="mb-12 flex justify-center">
            <div className="relative rounded-lg border border-scale-500 bg-scale-100 p-8 shadow-lg">
              <div className="mb-6 flex items-center gap-3 border-b border-scale-500 pb-4">
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-2.5 w-2.5 rounded-sm bg-teal-600"
                    />
                  ))}
                </div>
                <span className="text-xl font-semibold text-scale-1200">
                  SmartMarket Integration Layer
                </span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-scale-500 bg-teal-50 p-3">
                  <div className="h-2 w-2 rounded-full bg-teal-600 animate-pulse" />
                  <p className="text-sm font-medium text-scale-1100">
                    Syncing enterprise data with location intelligence...
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-scale-500 pt-3">
                  <div className="rounded-md border border-scale-500 bg-scale-50 p-2 text-center text-xs font-medium text-scale-1100">
                    Your Enterprise Data
                  </div>
                  <div className="rounded-md border border-scale-500 bg-scale-50 p-2 text-center text-xs font-medium text-scale-1100">
                    Location Intelligence
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {integrations.map((integration) => (
              <div
                key={integration}
                className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-scale-500 bg-scale-100 text-sm font-medium text-scale-1100 shadow-sm"
              >
                {integration}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
