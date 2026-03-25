import { Button } from "@rio.js/ui/button"
import { Input } from "@rio.js/ui/input"

export function HeroSection() {
  return (
    <section className="relative w-full bg-gradient-to-b from-teal-50 to-scale-100 py-24 lg:py-32">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-300 bg-teal-100/50 px-4 py-1.5 text-xs font-medium text-teal-600">
            <span className="h-2 w-2 rounded-full bg-teal-600" />
            MARKET INTELLIGENCE PLATFORM
          </div>

          <h1 className="mb-6 text-5xl font-bold tracking-tight text-scale-1200 lg:text-7xl">
            Know Your Market.{" "}
            <span className="relative inline-block">
              Own Your Growth.
              <span className="absolute -right-2 top-0 h-4 w-4 rounded bg-teal-600" />
            </span>
          </h1>

          <p className="mb-8 text-xl text-scale-1000 lg:text-2xl">
            SmartMarket combines your enterprise data with rich location
            intelligence to power expansion strategy and distribution
            optimization—so you get answers in minutes, not days.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <div className="relative w-full max-w-md">
              <Input
                type="email"
                placeholder="Your business email"
                pilled
                className="h-12 w-full border border-scale-500 bg-scale-100 pr-32 text-scale-1200 placeholder:text-scale-1000 focus:border-teal-600"
              />
              <Button
                className="absolute right-1 top-1 h-10 bg-teal-600 px-4 text-teal-50 hover:bg-scale-1100"
                size="sm"
                variant="default"
                pilled
              >
                Get Started
              </Button>
            </div>
          </div>

          <p className="mt-4 text-sm text-scale-1000">
            or{" "}
            <a
              href="#contact"
              className="font-medium text-teal-600 hover:underline"
            >
              schedule a demo to see SmartMarket in action
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}
