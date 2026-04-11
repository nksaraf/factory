import { Button } from "@rio.js/ui/button"
import { Icon, Icons } from "@rio.js/ui/icon"

// @ts-expect-error - PNG import handled by build system
import workflowsImage from "./workflows.png"

export function WorkflowsSection() {
  return (
    <section className="relative w-full bg-gradient-to-b from-scale-100 via-scale-50 to-scale-100 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-6xl">
          {/* Header Section */}
          <div className="mb-12 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-300 bg-teal-100/50 px-4 py-1.5 text-xs font-medium text-teal-600">
              <Icon icon={Icons.workflow} className="text-sm" />
              WORKFLOW BUILDER
            </div>

            <h2 className="mb-6 text-4xl font-bold text-scale-1200 lg:text-5xl">
              Build Your Own{" "}
              <span className="relative inline-block">
                Market Intelligence Workflows
                <span className="absolute -right-2 top-0 h-3 w-3 rounded bg-teal-600" />
              </span>
            </h2>

            <p className="mx-auto max-w-3xl text-xl leading-relaxed text-scale-1000">
              SmartMarket Workflows gives you a powerful, interactive playground
              to build custom market analysis pipelines, scoring models, and
              automated optimization systems. Connect nodes, run real-time
              computations, and transform location data into actionable growth
              strategies—all in an intuitive visual interface.
            </p>
          </div>

          {/* Features in Two Columns */}
          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                <Icon icon={Icons.workflow} className="text-sm" />
              </div>
              <div>
                <p className="font-semibold text-scale-1200">
                  Visual Pipeline Builder
                </p>
                <p className="text-sm text-scale-1000">
                  Drag and drop nodes to create complex market analysis
                  pipelines. Connect data sources, scoring models, and
                  optimization algorithms with an intuitive visual interface
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                <Icon icon={Icons.agent} className="text-sm" />
              </div>
              <div>
                <p className="font-semibold text-scale-1200">
                  Automated Distribution Optimization
                </p>
                <p className="text-sm text-scale-1000">
                  Build intelligent, AI-powered workflows that adapt and make
                  decisions based on market data. Create automated systems that
                  optimize beats, assign territories, and rebalance routes
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                <Icon icon={Icons.formula} className="text-sm" />
              </div>
              <div>
                <p className="font-semibold text-scale-1200">
                  Real-Time Market Scoring
                </p>
                <p className="text-sm text-scale-1000">
                  Run market computations in real-time as you build. See
                  opportunity scores instantly, iterate quickly on expansion
                  scenarios, and experiment with different territory strategies
                  in your playground
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                <Icon icon={Icons.database} className="text-sm" />
              </div>
              <div>
                <p className="font-semibold text-scale-1200">
                  Market Analysis Library
                </p>
                <p className="text-sm text-scale-1000">
                  Access a comprehensive library of market analysis nodes,
                  scoring models, and optimization algorithms. From white space
                  detection to revenue prediction, build exactly what you need
                </p>
              </div>
            </div>
          </div>

          {/* Button */}
          <div className="mb-12 text-center">
            <Button
              variant="default"
              size="lg"
              className="bg-teal-600 text-scale-100 hover:bg-teal-700"
              icon={Icons.workflow}
            >
              Explore Market Workflows
            </Button>
          </div>

          {/* Banner Image */}
          <div className="relative w-full overflow-hidden rounded-lg border border-scale-500 shadow-xl">
            <img
              src={workflowsImage}
              alt="SmartMarket Intelligence Workflows Interface"
              className="w-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
