import { ToolButton } from "@rio.js/gis-ui/components/tool-button"
import { useGIS } from "@rio.js/gis/hooks/use-gis"
import { useMapsRow } from "@rio.js/gis/store"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@rio.js/ui/dropdown-menu"

// Map style configurations
const mapStyles = [
  {
    id: 1,
    name: "Light Street",
    style: "light-street",
    supportingMapProviders: ["google", "mapbox"],
    image: "/street.png",
  },
  {
    id: 2,
    name: "Dark Street",
    style: "dark-street",
    supportingMapProviders: ["google", "mapbox"],
    image: "/dark.png",
  },
  {
    id: 3,
    name: "Satellite",
    style: "satellite",
    supportingMapProviders: ["google", "mapbox"],
    image: "/satellite.png",
  },
  {
    id: 4,
    name: "Light Grayscale",
    style: "light-grayscale",
    supportingMapProviders: ["google"],
    image: "/lightGrayscale.png",
  },
]

const mapProviders = [
  {
    id: 1,
    name: "Google",
    provider: "google",
    icon: "icon-[akar-icons--google-contained-fill]",
  },
  // Mapbox switching commented out for now
  // {
  //   id: 2,
  //   name: "Mapbox",
  //   provider: "mapbox",
  //   icon: "icon-[simple-icons--mapbox]",
  // },
]

interface MapSwitcherProps {
  mapId: string
  /** When true, removes default styling to work inside a button group */
  grouped?: boolean
}

export function MapSwitcher({ mapId, grouped = false }: MapSwitcherProps) {
  const gis = useGIS()
  const mapRow = useMapsRow(mapId)
  const currentProvider = mapRow?.provider || "google"
  const currentStyle = mapRow?.style || "light-street"

  // Filter map styles based on selected provider
  const filteredMapStyles = mapStyles.filter((style) =>
    style.supportingMapProviders.includes(
      currentProvider as "google" | "mapbox"
    )
  )

  // Get current style image (you can add images later if needed)
  const currentStyleInfo = mapStyles.find((item) => item.style === currentStyle)

  return (
    <ToolButton
      tooltip="Base Map Style"
      variant={grouped ? undefined : "square"}
      className={grouped ? "bg-transparent border-0 rounded-none h-9 w-9" : undefined}
      dropdownMenu={
        <>
          <DropdownMenuGroup>
            {mapProviders.map((provider) => {
              const isActive = currentProvider === provider.provider
              return (
                <DropdownMenuItem
                  key={provider.id}
                  data-state={isActive ? "active" : "inactive"}
                  className={
                    isActive
                      ? "bg-brand-500 text-white hover:bg-brand-600 hover:text-white"
                      : ""
                  }
                  onClick={() => {
                    // Update provider
                    gis.project.setMapsProviderCell(mapId, provider.provider)

                    // Reset map style if current style isn't supported by new provider
                    const currentStyleInfo = mapStyles.find(
                      (style) => style.style === currentStyle
                    )
                    if (
                      !currentStyleInfo?.supportingMapProviders.includes(
                        provider.provider
                      )
                    ) {
                      // Set to first available style for this provider
                      const firstSupportedStyle = mapStyles.find((style) =>
                        style.supportingMapProviders.includes(provider.provider)
                      )
                      if (firstSupportedStyle) {
                        gis.project.setMapsStyleCell(
                          mapId,
                          firstSupportedStyle.style
                        )
                      }
                    }
                  }}
                  disabled={provider.provider === "mapbox"} // Mapbox is not supported yet
                  icon={provider.icon}
                >
                  {provider.name}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {filteredMapStyles.map((item) => {
              const isActive = currentStyle === item.style
              return (
                <DropdownMenuItem
                  key={item.id}
                  data-state={isActive ? "active" : "inactive"}
                  className={
                    isActive
                      ? "bg-brand-500 text-white hover:bg-brand-600 hover:text-white"
                      : ""
                  }
                  onClick={() => {
                    gis.project.setMapsStyleCell(mapId, item.style)
                  }}
                >
                  <img
                    src={item.image}
                    alt={item.name}
                    className="size-4 rounded-sm object-cover"
                  />
                  {item.name}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </>
      }
      icon={
        currentStyleInfo?.image ? (
          <img
            src={currentStyleInfo.image}
            alt={currentStyleInfo.name}
            className="size-4 rounded-sm object-cover"
          />
        ) : (
          <div className="bg-scale-100 rounded-sm size-4 cursor-pointer flex items-center justify-center text-xs font-semibold">
            {currentStyleInfo?.name.charAt(0) || "M"}
          </div>
        )
      }
    />
  )
}
