import { Button } from "@rio.js/ui/button"
import { Icon, Icons } from "@rio.js/ui/icon"

export function AssistantSection() {
  return (
    <section className="relative w-full bg-gradient-to-br from-teal-600 via-teal-600 to-teal-700 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div className="text-scale-100">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-300/30 bg-teal-500/20 px-4 py-1.5 text-xs font-medium text-teal-100">
                <span className="h-2 w-2 rounded-full bg-teal-200 animate-pulse" />
                AI-POWERED ANALYST
              </div>

              <h2 className="mb-6 text-4xl font-bold text-scale-100 lg:text-5xl">
                Meet Your{" "}
                <span className="relative inline-block">
                  Market Intelligence Analyst
                  <span className="absolute -right-2 top-0 h-3 w-3 rounded bg-teal-200" />
                </span>
              </h2>

              <p className="mb-6 text-xl leading-relaxed text-teal-50">
                SmartMarket AI Analyst is your on-demand market strategist. Ask
                complex questions about market opportunities, get expansion
                insights, and run distribution analyses—all without writing a
                single query or waiting for a report.
              </p>

              <div className="mb-8 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-200 text-teal-700">
                    <Icon icon={Icons.check} className="text-sm" />
                  </div>
                  <div>
                    <p className="font-semibold text-scale-100">
                      Natural Language Queries
                    </p>
                    <p className="text-sm text-teal-50">
                      Ask questions in plain English. "Which territories have
                      the highest penetration gap?" or "Show me white space
                      opportunities in Mumbai West"
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-200 text-teal-700">
                    <Icon icon={Icons.check} className="text-sm" />
                  </div>
                  <div>
                    <p className="font-semibold text-scale-100">
                      Complex Analysis Made Simple
                    </p>
                    <p className="text-sm text-teal-50">
                      Run cannibalization modeling, forecast revenue for new
                      locations, identify underserved outlets, and generate
                      board-ready expansion reports—all through conversation
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-200 text-teal-700">
                    <Icon icon={Icons.check} className="text-sm" />
                  </div>
                  <div>
                    <p className="font-semibold text-scale-100">
                      Instant Insights
                    </p>
                    <p className="text-sm text-teal-50">
                      Get actionable market insights from 100+ location datasets
                      in seconds. The Analyst understands context, suggests
                      expansion strategies, and explains market dynamics clearly
                    </p>
                  </div>
                </div>
              </div>

              <Button
                variant="default"
                size="lg"
                className="bg-scale-100 text-teal-700 hover:bg-scale-200"
              >
                Try SmartMarket Analyst
              </Button>
            </div>

            <div className="relative">
              <div className="relative rounded-lg border border-teal-300/20 bg-teal-500/10 p-8 backdrop-blur-sm shadow-xl">
                {/* Chat interface mockup */}
                <div className="mb-4 flex items-center gap-3 border-b border-teal-300/20 pb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-200 text-teal-700">
                    <Icon icon={Icons.assistant} className="text-xl" />
                  </div>
                  <div>
                    <p className="font-semibold text-scale-100">
                      SmartMarket Analyst
                    </p>
                    <p className="text-xs text-teal-100">Online</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg bg-teal-600/30 p-4">
                    <p className="mb-2 text-sm font-medium text-scale-100">
                      You:
                    </p>
                    <p className="text-sm text-teal-50">
                      "Where should we open our next 5 stores in Bangalore?
                      Factor in competition density, footfall, and
                      cannibalization risk."
                    </p>
                  </div>

                  <div className="rounded-lg bg-teal-700/40 p-4">
                    <p className="mb-2 text-sm font-medium text-scale-100">
                      Analyst:
                    </p>
                    <p className="mb-3 text-sm text-teal-50">
                      I've analyzed 2,400+ micro-markets in Bangalore using
                      footfall, demographics, competitor density, and your
                      existing store catchments. Here are the top
                      recommendations:
                    </p>
                    <div className="space-y-2">
                      <div className="rounded border border-teal-300/20 bg-teal-600/20 p-2">
                        <p className="text-xs font-medium text-scale-100">
                          #1 Koramangala 4th Block — MOS: 92
                        </p>
                        <p className="text-xs text-teal-100">
                          High footfall (12K/day) • Low saturation • 0%
                          cannibalization • Predicted revenue: ₹18L/mo
                        </p>
                      </div>
                      <div className="rounded border border-teal-300/20 bg-teal-600/20 p-2">
                        <p className="text-xs font-medium text-scale-100">
                          #2 HSR Layout Sector 2 — MOS: 87
                        </p>
                        <p className="text-xs text-teal-100">
                          Growing area • 3 competitors nearby • 8%
                          cannibalization • Predicted revenue: ₹15L/mo
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-lg border border-teal-300/20 bg-teal-600/20 p-3">
                    <Icon
                      icon={Icons.sparkles}
                      className="text-sm text-teal-200"
                    />
                    <p className="text-xs text-teal-100">
                      Analyst is calculating cannibalization scenarios...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
