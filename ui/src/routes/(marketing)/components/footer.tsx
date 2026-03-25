import { Button } from "@rio.js/ui/button"
import { cn } from "@rio.js/ui/lib/utils"

export function Footer() {
  return (
    <footer className="relative w-full bg-scale-200 py-16">
      <div className="container mx-auto px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-scale-1200 lg:text-5xl">
            Ready to Expand with Confidence?
          </h2>
          <p className="mb-6 text-lg text-scale-1000">
            Join 1000+ companies using SmartMarket to make data-driven location
            decisions
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button variant="default" size="lg">
              Schedule a Demo
            </Button>
            <Button variant="outline" size="lg">
              Request Access
            </Button>
          </div>
        </div>

        <div className="border-t border-scale-500 pt-12">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="grid grid-cols-3 gap-0.5">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-1.5 w-1.5 rounded-sm bg-teal-600"
                    />
                  ))}
                </div>
                <span className="text-lg font-semibold text-scale-1200">
                  SmartMarket
                </span>
              </div>
              <p className="text-sm text-scale-1000">
                © 2025 SmartMarket. All rights reserved.
              </p>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-scale-1000">
                Product
              </h3>
              <ul className="space-y-2 text-sm text-scale-1000">
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    Pricing
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    Integrations
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-scale-1000">
                Legal
              </h3>
              <ul className="space-y-2 text-sm text-scale-1000">
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    Security
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    Privacy
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    Terms
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-scale-1200 transition-colors"
                  >
                    End User License Agreement
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
