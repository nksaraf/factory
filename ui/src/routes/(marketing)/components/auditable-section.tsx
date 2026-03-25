import { Icon, Icons } from "@rio.js/ui/icon"

// Floating icon configuration with position, size, rotation, and color
type FloatingIconConfig = {
  icon: string
  x: number // percentage (0-100)
  y: number // percentage (0-100)
  size: number // in pixels
  rotation: number // in degrees
  color: string // tailwind color class
}

const dataCategories = [
  {
    icon: Icons.population,
    title: "Demographics & Affluence",
    data: "100M+ records",
    description:
      "Census data, income levels, population density, age distribution",
    floatingIcons: [
      {
        icon: Icons.population,
        x: 15,
        y: 20,
        size: 24,
        rotation: -12,
        color: "text-teal-500",
      },
      {
        icon: Icons.income,
        x: 75,
        y: 30,
        size: 20,
        rotation: 15,
        color: "text-brand-500",
      },
      {
        icon: Icons.wallet,
        x: 50,
        y: 65,
        size: 28,
        rotation: -8,
        color: "text-teal-600",
      },
      {
        icon: Icons.age,
        x: 25,
        y: 75,
        size: 22,
        rotation: 20,
        color: "text-brand-400",
      },
      {
        icon: Icons.gender,
        x: 80,
        y: 70,
        size: 26,
        rotation: -18,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.pois,
    title: "Points of Interest",
    data: "30M+ POIs",
    description: "Across 300+ categories with reviews & ratings",
    floatingIcons: [
      {
        icon: Icons.pois,
        x: 20,
        y: 25,
        size: 28,
        rotation: -10,
        color: "text-teal-500",
      },
      {
        icon: Icons.mapPin,
        x: 70,
        y: 20,
        size: 22,
        rotation: 18,
        color: "text-brand-500",
      },
      {
        icon: Icons.store,
        x: 45,
        y: 60,
        size: 26,
        rotation: -15,
        color: "text-teal-600",
      },
      {
        icon: Icons.poi,
        x: 80,
        y: 65,
        size: 24,
        rotation: 12,
        color: "text-brand-400",
      },
      {
        icon: Icons.map,
        x: 15,
        y: 70,
        size: 30,
        rotation: -20,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.footfall,
    title: "Footfall & Visitor Patterns",
    data: "150m grids",
    description: "Real-time footfall, visitor patterns, peak hours",
    floatingIcons: [
      {
        icon: Icons.footfall,
        x: 25,
        y: 20,
        size: 30,
        rotation: -12,
        color: "text-teal-500",
      },
      {
        icon: Icons.crowd,
        x: 75,
        y: 25,
        size: 24,
        rotation: 16,
        color: "text-brand-500",
      },
      {
        icon: Icons.team,
        x: 50,
        y: 55,
        size: 26,
        rotation: -8,
        color: "text-teal-600",
      },
      {
        icon: Icons.user,
        x: 20,
        y: 70,
        size: 22,
        rotation: 22,
        color: "text-brand-400",
      },
      {
        icon: Icons.friend,
        x: 80,
        y: 75,
        size: 28,
        rotation: -18,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.infrastructure,
    title: "Infrastructure",
    data: "50K+ projects",
    description:
      "Roads, bridges, utilities, upcoming projects, development zones",
    floatingIcons: [
      {
        icon: Icons.infrastructure,
        x: 30,
        y: 25,
        size: 28,
        rotation: -14,
        color: "text-teal-500",
      },
      {
        icon: Icons.bridges,
        x: 70,
        y: 30,
        size: 24,
        rotation: 12,
        color: "text-brand-500",
      },
      {
        icon: Icons.city,
        x: 45,
        y: 60,
        size: 30,
        rotation: -10,
        color: "text-teal-600",
      },
      {
        icon: Icons.buildings,
        x: 15,
        y: 65,
        size: 26,
        rotation: 18,
        color: "text-brand-400",
      },
      {
        icon: Icons.internal,
        x: 80,
        y: 70,
        size: 22,
        rotation: -16,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.mobility,
    title: "Mobility & Transit",
    data: "10K+ routes",
    description:
      "Public transit routes, stations, traffic patterns, accessibility",
    floatingIcons: [
      {
        icon: Icons.mobility,
        x: 25,
        y: 20,
        size: 28,
        rotation: -10,
        color: "text-teal-500",
      },
      {
        icon: Icons.car,
        x: 75,
        y: 25,
        size: 26,
        rotation: 14,
        color: "text-brand-500",
      },
      {
        icon: Icons.traffic,
        x: 50,
        y: 55,
        size: 30,
        rotation: -12,
        color: "text-teal-600",
      },
      {
        icon: Icons.bus,
        x: 20,
        y: 70,
        size: 24,
        rotation: 20,
        color: "text-brand-400",
      },
      {
        icon: Icons.train,
        x: 80,
        y: 75,
        size: 22,
        rotation: -16,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.buildings,
    title: "Real Estate",
    data: "5M+ properties",
    description: "Property values, rental rates, commercial spaces",
    floatingIcons: [
      {
        icon: Icons.buildings,
        x: 30,
        y: 20,
        size: 30,
        rotation: -12,
        color: "text-teal-500",
      },
      {
        icon: Icons.home,
        x: 70,
        y: 25,
        size: 24,
        rotation: 16,
        color: "text-brand-500",
      },
      {
        icon: Icons.homeRounded,
        x: 45,
        y: 60,
        size: 26,
        rotation: -10,
        color: "text-teal-600",
      },
      {
        icon: Icons.realEstate,
        x: 20,
        y: 70,
        size: 28,
        rotation: 18,
        color: "text-brand-400",
      },
      {
        icon: Icons.city,
        x: 75,
        y: 75,
        size: 22,
        rotation: -14,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.economic,
    title: "Economic Indicators",
    data: "Real-time updates",
    description:
      "Business density, employment data, market trends, economic zones",
    floatingIcons: [
      {
        icon: Icons.economic,
        x: 25,
        y: 25,
        size: 28,
        rotation: -10,
        color: "text-teal-500",
      },
      {
        icon: Icons.chartLine,
        x: 75,
        y: 20,
        size: 24,
        rotation: 14,
        color: "text-brand-500",
      },
      {
        icon: Icons.pieChart,
        x: 50,
        y: 55,
        size: 26,
        rotation: -12,
        color: "text-teal-600",
      },
      {
        icon: Icons.trendingUp,
        x: 20,
        y: 70,
        size: 22,
        rotation: 18,
        color: "text-brand-400",
      },
      {
        icon: Icons.barchart,
        x: 80,
        y: 75,
        size: 30,
        rotation: -16,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
  {
    icon: Icons.review,
    title: "Reviews & Ratings",
    data: "100M+ reviews",
    description: "Customer sentiment, ratings, review volume, quality metrics",
    floatingIcons: [
      {
        icon: Icons.review,
        x: 30,
        y: 20,
        size: 28,
        rotation: -12,
        color: "text-teal-500",
      },
      {
        icon: Icons.star,
        x: 70,
        y: 25,
        size: 26,
        rotation: 16,
        color: "text-brand-500",
      },
      {
        icon: Icons.starOwner,
        x: 45,
        y: 60,
        size: 24,
        rotation: -10,
        color: "text-teal-600",
      },
      {
        icon: Icons.shoppingCart,
        x: 20,
        y: 70,
        size: 22,
        rotation: 18,
        color: "text-brand-400",
      },
      {
        icon: Icons.friend,
        x: 75,
        y: 75,
        size: 30,
        rotation: -14,
        color: "text-teal-400",
      },
    ] as FloatingIconConfig[],
  },
]

function FloatingIcons({ icons }: { icons: FloatingIconConfig[] }) {
  // Map size to Tailwind text size classes
  // const getSizeClass = (size: number) => {
  //   if (size <= 18) return "text-[]"
  //   if (size <= 20) return "text-sm"
  //   if (size <= 22) return "text-base"
  //   if (size <= 24) return "text-lg"
  //   if (size <= 26) return "text-xl"
  //   if (size <= 28) return "text-2xl"
  //   return "text-3xl"
  // }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {icons.map((iconConfig, index) => (
        <div
          key={index}
          className="absolute opacity-60 transition-opacity duration-300 group-hover:opacity-80"
          style={{
            left: `${iconConfig.x}%`,
            top: `${iconConfig.y}%`,
            transform: `translate(-50%, -50%) rotate(${iconConfig.rotation}deg)`,
          }}
        >
          <Icon
            icon={iconConfig.icon}
            style={{ fontSize: `${iconConfig.size * 3}px` }}
            className={`${iconConfig.color}`}
          />
        </div>
      ))}
    </div>
  )
}

export function AuditableSection() {
  return (
    <section className="w-full bg-scale-100 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-scale-1200 lg:text-5xl">
              The Most Comprehensive Location Data Observatory
            </h2>
            <p className="mx-auto max-w-3xl text-lg leading-relaxed text-scale-1000">
              SmartMarket unifies 100+ datasets—from real-time footfall at 150m
              grids to 30M+ POIs across 300+ categories. Every recommendation is
              backed by verified, up-to-date location intelligence. No
              guesswork. Just data.
            </p>
          </div>

          {/* 3-column grid with lined borders */}
          <div className="grid grid-cols-1 gap-px border border-scale-500 bg-scale-500 md:grid-cols-2 lg:grid-cols-3">
            {dataCategories.map((category, index) => (
              <div
                key={index}
                className="group relative bg-scale-100 p-6 py-8 transition-all hover:bg-scale-50"
              >
                {/* Icon and Title */}
                {/* <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-600 transition-colors group-hover:bg-teal-200">
                    <Icon icon={category.icon} className="text-xl" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-scale-1200 text-base">
                      {category.title}
                    </h3>
                  </div>
                </div> */}

                {/* Floating Icons Visualization */}
                <div className="mb-4 h-32 w-full rounded-lg bg-gradient-to-br from-scale-50 to-scale-100 p-4">
                  <FloatingIcons icons={category.floatingIcons} />
                </div>

                {/* Data Metric */}
                <div className="mb-2 flex flex-col">
                  <h3 className="font-semibold text-scale-1200 text-lg">
                    {category.data}
                  </h3>
                  <div className="text-2xl font-bold text-teal-600">
                    {category.title}
                  </div>
                </div>

                {/* Description */}
                <p className="text-base leading-relaxed text-scale-1000">
                  {category.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
