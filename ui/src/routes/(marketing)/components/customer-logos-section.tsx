export function CustomerLogosSection() {
  const partners = [
    "Samsung",
    "VBL / PepsiCo",
    "Leading FMCG",
    "Top QSR Chain",
    "National Retailer",
    "Google Maps",
  ]

  return (
    <section className="relative w-full bg-scale-100 py-12 lg:py-16">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <p className="text-sm font-medium text-scale-1000">
              Trusted by leading FMCG, Retail, and QSR enterprises
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-16">
            {partners.map((partner) => (
              <div
                key={partner}
                className="flex items-center justify-center transition-opacity hover:opacity-70"
              >
                <span className="text-lg font-semibold text-scale-800 lg:text-xl">
                  {partner}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
