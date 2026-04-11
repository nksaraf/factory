import { cn } from "@rio.js/ui/lib/utils"

export function TestimonialSection() {
  return (
    <section className="relative w-full bg-gradient-to-br from-teal-600 via-teal-650 to-teal-700 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-3xl text-center">
          <blockquote className="mb-8 text-3xl font-semibold leading-relaxed text-scale-100 lg:text-5xl">
            "SmartMarket cut our site selection cycle from 6 weeks to 3 days. We
            opened 40 new outlets last quarter—every one hitting revenue targets
            within 90 days."
          </blockquote>
          <p className="text-lg font-medium text-teal-100">
            Head of Expansion, Leading QSR Chain
          </p>
        </div>
      </div>
    </section>
  )
}
