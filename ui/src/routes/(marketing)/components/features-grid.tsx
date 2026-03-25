import { Icon, Icons } from "@rio.js/ui/icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rio.js/ui/tabs"

interface Feature {
  title: string
  description: string
  icon?: string
}

interface IndustryFeatures {
  industry: string
  icon: string
  features: Feature[]
}

// Helper function to chunk features into alternating rows of 2 and 3
function chunkFeatures(features: Feature[]): Feature[][] {
  const chunks: Feature[][] = []
  let i = 0
  let rowSize = 2 // Start with 2

  while (i < features.length) {
    const chunk = features.slice(i, i + rowSize)
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
    i += rowSize
    rowSize = rowSize === 2 ? 3 : 2 // Alternate between 2 and 3
  }

  return chunks
}

const industryFeatures: IndustryFeatures[] = [
  {
    industry: "Core Capabilities",
    icon: Icons.dashboard,
    features: [
      {
        title: "DISCOVER",
        description:
          "Unify 100+ location datasets—demographics, footfall, POIs, competition, infrastructure—into a single market view. See opportunity where others see noise.",
        icon: Icons.map,
      },
      {
        title: "ANALYZE",
        description:
          "Score every micro-market using AI-powered opportunity indices. Rank locations by revenue potential, competitive intensity, and market readiness in seconds.",
        icon: Icons.chartLine,
      },
      {
        title: "OPTIMIZE",
        description:
          "Design optimal territories, plan efficient beats, and build routes that maximize outlet coverage while minimizing travel time and cost.",
        icon: Icons.workflow,
      },
      {
        title: "GROW",
        description:
          "Identify the best sites for expansion, predict revenue with confidence, model cannibalization risk, and build board-ready business cases backed by data.",
        icon: Icons.dashboard,
      },
    ],
  },
  {
    industry: "Use Cases",
    icon: Icons.workflow,
    features: [
      {
        title: "Beat Planning & Field Force Optimization",
        description:
          "Design optimal daily beats for your field force. Balance outlet coverage, travel time, and visit frequency to maximize productivity. Auto-assign reps to territories based on workload and geography.",
        icon: Icons.map,
      },
      {
        title: "Route Optimization",
        description:
          "Generate the most efficient routes for delivery and sales teams. Factor in time windows, vehicle capacity, road conditions, and priority outlets to reduce fuel costs and increase daily stops.",
        icon: Icons.workflow,
      },
      {
        title: "New Store / Site Selection",
        description:
          "Score potential locations using demographics, footfall, competition density, accessibility, and catchment analysis. Predict revenue before signing a lease with AI-powered site scoring models.",
        icon: Icons.search,
      },
      {
        title: "Revenue Prediction & Cannibalization",
        description:
          "Forecast revenue for new and existing outlets using ML models trained on your sales data and 100+ market signals. Model cannibalization scenarios to protect your existing network while growing.",
        icon: Icons.chartLine,
      },
      {
        title: "White Space Analysis",
        description:
          "Find untapped markets and underserved areas where demand exists but supply doesn't. Overlay your distribution network against market potential to identify gaps worth filling.",
        icon: Icons.warning,
      },
      {
        title: "Territory Design & Assignment",
        description:
          "Create balanced territories using population density, outlet counts, revenue potential, and geographic boundaries. Ensure fair workload distribution and maximize market coverage.",
        icon: Icons.dashboard,
      },
    ],
  },
]

export function FeaturesGrid() {
  return (
    <section className="w-full bg-scale-100 py-24">
      <div className="container mx-auto px-6">
        <div className="mb-16 text-center">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-scale-1000">
            MARKET INTELLIGENCE PLATFORM
          </p>
          <h2 className="mb-4 text-4xl font-bold text-scale-1200 lg:text-5xl">
            From Data to{" "}
            <span className="relative inline-block">
              Decisive Action
              <span className="absolute -right-2 top-0 h-3 w-3 rounded bg-teal-600" />
            </span>
          </h2>
          <p className="text-lg text-scale-1000">
            SmartMarket transforms location intelligence and enterprise data into
            actionable growth strategies. Score markets, optimize distribution,
            predict revenue, and identify white space—all powered by AI.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-scale-500 bg-scale-200 px-4 py-2">
            <span className="text-sm font-medium text-scale-1100">
              Built on 100+ verified location datasets
            </span>
          </div>
        </div>

        <Tabs defaultValue={industryFeatures[0].industry} className="w-full">
          <TabsList className="mb-8 w-full justify-start bg-transparent p-0 h-auto border-b border-scale-500 rounded-none">
            {industryFeatures.map((industry) => (
              <TabsTrigger
                key={industry.industry}
                value={industry.industry}
                className="px-6 py-4 text-lg flex flex-col items-centerfont-semibold rounded-none border-t-0 border-x-0 border-b-2 border-transparent data-[state=active]:border-teal-600 focus-visible:ring-0 data-[state=active]:bg-transparent data-[state=active]:text-teal-600 data-[state=active]:text-scale-1200 text-scale-1000 flex items-center gap-3"
              >
                <Icon icon={industry.icon} className="text-icon-4xl" />
                <span>{industry.industry}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {industryFeatures.map((industry) => {
            const featureRows = chunkFeatures(industry.features)
            return (
              <TabsContent key={industry.industry} value={industry.industry}>
                <div className="space-y-px">
                  {featureRows.map((row, rowIndex) => {
                    const isTwoColumn = row.length === 2
                    const gridCols = isTwoColumn
                      ? "md:grid-cols-2"
                      : "md:grid-cols-3"

                    return (
                      <div
                        key={rowIndex}
                        className={`grid grid-cols-1 ${gridCols} gap-px border border-scale-500 bg-scale-500`}
                      >
                        {row.map((feature, featureIndex) => (
                          <div
                            key={featureIndex}
                            className={`group relative bg-scale-100 p-6 transition-all hover:bg-scale-50 ${
                              isTwoColumn ? "flex gap-6" : ""
                            }`}
                          >
                            {/* Visualization Placeholder */}
                            <div
                              className={`rounded-lg bg-gradient-to-br from-scale-50 to-scale-100 p-4 border border-scale-400 ${
                                isTwoColumn
                                  ? "h-32 w-32 flex-shrink-0"
                                  : "mb-4 h-40 w-full"
                              }`}
                            >
                              <div className="flex h-full items-center justify-center">
                                <div className="flex flex-col items-center gap-2 text-scale-600">
                                  <Icon
                                    icon={Icons.chartLine}
                                    className={`${
                                      isTwoColumn ? "text-3xl" : "text-4xl"
                                    } opacity-50`}
                                  />
                                  {!isTwoColumn && (
                                    <span className="text-xs font-medium opacity-70">
                                      Visualization
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Feature Content */}
                            <div className={isTwoColumn ? "flex-1" : ""}>
                              <h3 className="mb-2 text-xl font-semibold text-scale-1200">
                                {feature.title}
                              </h3>
                              <p className="leading-relaxed text-scale-1000">
                                {feature.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </TabsContent>
            )
          })}
        </Tabs>
      </div>
    </section>
  )
}
