import { cn } from "@rio.js/ui/lib/utils"

export function VideoSection() {
  return (
    <section className="relative w-full bg-gradient-to-b from-scale-100 via-teal-50 to-scale-100 py-16">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-6xl">
          <div className="relative aspect-[calc(1915/807)] w-full overflow-hidden rounded-lg border border-scale-500 shadow-lg bg-[url('/demo.png')] bg-cover bg-center">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <button className="flex h-20 w-20 items-center justify-center rounded-full bg-scale-1200 text-scale-100 shadow-lg transition-transform hover:scale-110">
                  <svg
                    className="ml-1 h-8 w-8"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <p className="text-sm font-medium text-scale-1100">
                  Watch Demo
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
