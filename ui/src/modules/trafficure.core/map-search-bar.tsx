import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"

import { rio } from "@rio.js/client"
import { MapLayer } from "@rio.js/maps-ui/components/map-layer"
import { useMap } from "@rio.js/maps-ui/hooks/use-map"
import { IconLayer } from "@rio.js/maps-ui/lib/deck-gl/layers"
import { useDebouncedValue } from "@rio.js/ui"
import { Button } from "@rio.js/ui/button"
import { Icons } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"
import { cn } from "@rio.js/ui/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@rio.js/ui/tooltip"

// Type definitions
interface ApiResponse<T> {
  success: boolean
  data: T
  message: string
}

interface PlacesAutocompleteRequest {
  input: string
  languageCode?: string
  includedRegionCodes?: string[]
  locationBias?: {
    rectangle?: {
      low: { latitude: number; longitude: number }
      high: { latitude: number; longitude: number }
    }
    circle?: {
      center: { latitude: number; longitude: number }
      radius: number
    }
  }
}

interface PlacePrediction {
  placeId: string
  text?: { text: string }
  structuredFormat?: {
    mainText?: { text: string }
    secondaryText?: { text: string }
  }
  types?: string[]
  distanceMeters?: number
}

interface Suggestion {
  placePrediction?: PlacePrediction
}

interface PlacesAutocompleteResponse {
  suggestions?: Suggestion[]
}

interface LegacyAutocompletePrediction {
  place_id: string
  description: string
  structured_formatting: {
    main_text: string
    secondary_text: string
  }
  types: string[]
  distance_meters?: number
}

interface PlaceDetails {
  id: string
  displayName: { text: string }
  formattedAddress: string
  location: {
    latitude: number
    longitude: number
  }
  types: string[]
}

interface PlaceDetailsResponse {
  id: string
  displayName: { text: string }
  formattedAddress: string
  location: {
    latitude: number
    longitude: number
  }
  types: string[]
}

// Query keys helper
const queryKeys = {
  placesAutocomplete: (input: string) =>
    ["places", "autocomplete", input] as const,
  placeDetails: (placeId: string) => ["places", "details", placeId] as const,
}

// Get Google Maps API key from environment
const getGoogleMapsApiKey = (): string | undefined => {
  try {
    return rio.env.PUBLIC_GOOGLE_MAPS_API_KEY
  } catch {
    return undefined
  }
}

// Places API functions
export const placesApi = {
  // Autocomplete using new Places API (New)
  autocomplete: async (
    input: string,
    options?: {
      bounds?: google.maps.LatLngBounds
      location?: google.maps.LatLng
      radius?: number
      languageCode?: string
      abortSignal?: AbortSignal
    }
  ): Promise<ApiResponse<LegacyAutocompletePrediction[]>> => {
    try {
      if (options?.abortSignal?.aborted) {
        return {
          success: false,
          data: [],
          message: "Request was aborted",
        }
      }

      if (!input || input.trim().length < 3) {
        return {
          success: true,
          data: [],
          message: "Input too short",
        }
      }

      const apiKey = getGoogleMapsApiKey()
      if (!apiKey) {
        return {
          success: false,
          data: [],
          message: "Google Maps API key not configured",
        }
      }

      const requestBody: PlacesAutocompleteRequest = {
        input: input.trim(),
        languageCode: options?.languageCode || "en",
      }

      // Add location biasing if provided
      if (options?.bounds) {
        const ne = options.bounds.getNorthEast()
        const sw = options.bounds.getSouthWest()
        requestBody.locationBias = {
          rectangle: {
            low: {
              latitude: sw.lat(),
              longitude: sw.lng(),
            },
            high: {
              latitude: ne.lat(),
              longitude: ne.lng(),
            },
          },
        }
      } else if (options?.location && options?.radius) {
        requestBody.locationBias = {
          circle: {
            center: {
              latitude: options.location.lat(),
              longitude: options.location.lng(),
            },
            radius: options.radius,
          },
        }
      }

      const response = await fetch(
        `https://places.googleapis.com/v1/places:autocomplete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types,suggestions.placePrediction.distanceMeters",
          },
          body: JSON.stringify(requestBody),
          signal: options?.abortSignal,
        }
      )

      if (options?.abortSignal?.aborted) {
        return {
          success: false,
          data: [],
          message: "Request was aborted",
        }
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error(
          "❌ Google Places API (New) error:",
          response.status,
          errorText
        )
        return {
          success: false,
          data: [],
          message: `Places API error: ${response.status}`,
        }
      }

      const data: PlacesAutocompleteResponse = await response.json()

      // Convert new API format to legacy format for compatibility
      const predictions: LegacyAutocompletePrediction[] =
        data.suggestions
          ?.map((suggestion) => {
            // Safely extract data with fallbacks
            const placePrediction = suggestion.placePrediction
            if (!placePrediction) return null

            const text = placePrediction.text?.text || ""
            const structuredFormat = placePrediction.structuredFormat
            const mainText = structuredFormat?.mainText?.text || text || ""
            const secondaryText = structuredFormat?.secondaryText?.text || ""

            const prediction: LegacyAutocompletePrediction = {
              place_id: placePrediction.placeId || "",
              description: text,
              structured_formatting: {
                main_text: mainText,
                secondary_text: secondaryText,
              },
              types: placePrediction.types || [],
            }

            // Only add distance_meters if it exists
            if (placePrediction.distanceMeters !== undefined) {
              prediction.distance_meters = placePrediction.distanceMeters
            }

            return prediction
          })
          .filter(
            (pred): pred is LegacyAutocompletePrediction => pred !== null
          ) || []

      return {
        success: true,
        data: predictions,
        message: "Autocomplete successful",
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          data: [],
          message: "Request was aborted",
        }
      }
      console.error("❌ Google Places API (New) error:", error)
      return {
        success: false,
        data: [],
        message:
          error instanceof Error ? error.message : "Failed to fetch places",
      }
    }
  },

  // Get place details using new Places API (New)
  getPlaceDetails: async (
    placeId: string,
    options?: {
      languageCode?: string
      abortSignal?: AbortSignal
    }
  ): Promise<ApiResponse<PlaceDetails>> => {
    try {
      if (options?.abortSignal?.aborted) {
        return {
          success: false,
          data: null as any,
          message: "Request was aborted",
        }
      }

      const apiKey = getGoogleMapsApiKey()
      if (!apiKey) {
        return {
          success: false,
          data: null as any,
          message: "Google Maps API key not configured",
        }
      }

      const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "id,displayName,formattedAddress,location,types",
          },
          signal: options?.abortSignal,
        }
      )

      if (options?.abortSignal?.aborted) {
        return {
          success: false,
          data: null as any,
          message: "Request was aborted",
        }
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error(
          "❌ Google Places API (New) details error:",
          response.status,
          errorText
        )
        return {
          success: false,
          data: null as any,
          message: `Places API error: ${response.status}`,
        }
      }

      const data: PlaceDetailsResponse = await response.json()

      return {
        success: true,
        data: {
          id: data.id,
          displayName: data.displayName,
          formattedAddress: data.formattedAddress,
          location: data.location,
          types: data.types,
        },
        message: "Place details fetched successfully",
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          data: null as any,
          message: "Request was aborted",
        }
      }
      console.error("❌ Google Places API (New) details error:", error)
      return {
        success: false,
        data: null as any,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch place details",
      }
    }
  },
}

// Places API hooks (New Places API REST)
const usePlacesAutocomplete = (
  input: string,
  options?: {
    bounds?: google.maps.LatLngBounds
    location?: google.maps.LatLng
    radius?: number
    enabled?: boolean
  }
) => {
  return useQuery({
    queryKey: queryKeys.placesAutocomplete(input),
    queryFn: async () => {
      const response = await placesApi.autocomplete(input, {
        bounds: options?.bounds,
        location: options?.location,
        radius: options?.radius,
      })
      if (!response.success) throw new Error(response.message)
      return response.data
    },
    enabled:
      (options?.enabled ?? true) &&
      !!input &&
      input.trim().length >= 3 &&
      !!getGoogleMapsApiKey(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
  })
}

const usePlaceDetails = (placeId: string | null) => {
  return useQuery({
    queryKey: queryKeys.placeDetails(placeId || ""),
    queryFn: async () => {
      if (!placeId) throw new Error("Place ID is required")
      const response = await placesApi.getPlaceDetails(placeId)
      if (!response.success) throw new Error(response.message)
      return response.data
    },
    enabled: !!placeId && !!getGoogleMapsApiKey(),
    staleTime: 30 * 60 * 1000, // 30 minutes - place details don't change often
    gcTime: 60 * 60 * 1000, // 1 hour
  })
}

interface MapSearchBarProps {
  isProjectPage?: boolean
  /** When true, removes default positioning to work inside a button group */
  grouped?: boolean
}

// Detect if input looks like coordinates
const looksLikeCoordinates = (input: string): boolean => {
  const trimmed = input.trim()
  if (!trimmed) return false

  // Split by comma or space
  const parts = trimmed.split(/[,\s]+/).filter((p) => p.length > 0)

  if (parts.length !== 2) return false

  // Check if both parts are numbers
  const lat = parseFloat(parts[0])
  const lng = parseFloat(parts[1])

  return !isNaN(lat) && !isNaN(lng)
}

// Convert legacy prediction format to Google Maps format for compatibility
const convertToGoogleMapsPrediction = (prediction: {
  place_id: string
  description: string
  structured_formatting: {
    main_text: string
    secondary_text: string
  }
  types: string[]
}): google.maps.places.AutocompletePrediction => {
  return {
    place_id: prediction.place_id,
    description: prediction.description,
    structured_formatting: {
      main_text: prediction.structured_formatting.main_text,
      secondary_text: prediction.structured_formatting.secondary_text,
      main_text_matched_substrings: [],
      secondary_text_matched_substrings: [],
    },
    types: prediction.types,
    matched_substrings: [],
    terms: [],
    reference: "",
  } as unknown as google.maps.places.AutocompletePrediction
}

// AutocompleteDropdown Component
interface AutocompleteDropdownProps {
  predictions: google.maps.places.AutocompletePrediction[]
  isOpen: boolean
  selectedIndex: number
  onSelect: (prediction: google.maps.places.AutocompletePrediction) => void
  onClose: () => void
  isLoading: boolean
  anchorElement: HTMLElement | null
  showMinCharsMessage: boolean
}

const AutocompleteDropdown: React.FC<AutocompleteDropdownProps> = ({
  predictions,
  isOpen,
  selectedIndex,
  onSelect,
  isLoading,
  showMinCharsMessage,
}) => {
  if (!isOpen) return null

  return (
    <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-scale-800 border border-scale-700 dark:border-scale-600 rounded-md shadow-lg z-50 max-h-64 overflow-y-auto pretty-scrollbar">
      {isLoading ? (
        <div className="px-4 py-3 text-sm text-scale-900 dark:text-scale-400">
          Loading...
        </div>
      ) : showMinCharsMessage ? (
        <div className="px-4 py-3 text-sm text-scale-900 dark:text-scale-400">
          Type at least 3 characters to search
        </div>
      ) : predictions.length === 0 ? (
        <div className="px-4 py-3 text-sm text-scale-900 dark:text-scale-400">
          No results found
        </div>
      ) : (
        <div className="py-1">
          {predictions.map((prediction, index) => (
            <button
              key={prediction.place_id}
              type="button"
              onClick={() => onSelect(prediction)}
              className={cn(
                "w-full text-left px-4 py-2 text-sm hover:bg-scale-200 dark:hover:bg-scale-700 transition-colors",
                selectedIndex === index && "bg-scale-200 dark:bg-scale-700"
              )}
            >
              <div className="font-medium text-scale-1200 dark:text-scale-100">
                {prediction.structured_formatting.main_text}
              </div>
              {prediction.structured_formatting.secondary_text && (
                <div className="text-xs text-scale-900 dark:text-scale-400">
                  {prediction.structured_formatting.secondary_text}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const MapSearchBar: React.FC<MapSearchBarProps> = ({
  isProjectPage = true,
  grouped = false,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  const [searchValue, setSearchValue] = useState("")
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [placeSelected, setPlaceSelected] = useState(false)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)

  // Debounce search value with 300ms delay
  const debouncedSearchValue = useDebouncedValue(searchValue, 300)

  // Get map state using useMap hook
  const setViewState = useMap((map) => map.setViewState)
  const viewState = useMap((map) => map.viewState)

  // Get current map viewport for location biasing (for Google Places API)
  const getMapBounds = (): google.maps.LatLngBounds | undefined => {
    // Create bounds from current viewState
    if (!viewState) return undefined

    const lat = viewState.latitude
    const lng = viewState.longitude
    const zoom = viewState.zoom || 12

    // Approximate bounds based on zoom level
    // At zoom level z, one pixel represents approximately 156543.03392 * cos(lat) / 2^z meters
    const metersPerPixel =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
    const latDelta = (metersPerPixel * 256) / 111320 // Approximate conversion
    const lngDelta =
      (metersPerPixel * 256) / (111320 * Math.cos((lat * Math.PI) / 180))

    return new google.maps.LatLngBounds(
      new google.maps.LatLng(lat - latDelta, lng - lngDelta),
      new google.maps.LatLng(lat + latDelta, lng + lngDelta)
    )
  }

  const getMapCenter = (): google.maps.LatLng | undefined => {
    if (!viewState) return undefined
    return new google.maps.LatLng(viewState.latitude, viewState.longitude)
  }

  // Use TanStack Query hook for autocomplete
  const trimmedInput = debouncedSearchValue.trim()
  const isCoordinates = looksLikeCoordinates(trimmedInput)
  const shouldFetchAutocomplete =
    !isCoordinates && trimmedInput.length >= 3 && isSearchExpanded

  const {
    data: autocompleteData,
    isLoading: isLoadingAutocomplete,
    error: autocompleteError,
  } = usePlacesAutocomplete(trimmedInput, {
    bounds: shouldFetchAutocomplete ? getMapBounds() : undefined,
    location: shouldFetchAutocomplete ? getMapCenter() : undefined,
    radius: shouldFetchAutocomplete ? 50000 : undefined, // 50km
    enabled: shouldFetchAutocomplete,
  })

  // Convert to Google Maps format
  const autocompleteResults: google.maps.places.AutocompletePrediction[] =
    autocompleteData?.map(convertToGoogleMapsPrediction) || []

  // Icon data for the marker
  const iconData = selectedLocation
    ? [
        {
          coordinates: [selectedLocation.lng, selectedLocation.lat],
          name: searchValue || "Search Location",
        },
      ]
    : []

  // Navigate to coordinates on map
  const navigateToCoordinates = useCallback(
    (lat: number, lng: number) => {
      try {
        if (!setViewState) {
          console.warn("Map setViewState not available")
          setSearchError(true)
          setErrorMessage("Map not available")
          return
        }

        // Update map viewState to navigate to coordinates
        setViewState((prevViewState) => ({
          ...prevViewState,
          latitude: lat,
          longitude: lng,
          zoom:
            prevViewState.zoom && prevViewState.zoom >= 10
              ? prevViewState.zoom
              : 15,
          transitionDuration: 1000, // Smooth transition
        }))

        // Store selected location
        setSelectedLocation({ lat, lng })

        setSearchError(false)
        setErrorMessage("")
      } catch (error) {
        console.error("Failed to update map view:", error)
        setSearchError(true)
        setErrorMessage("Failed to navigate to location")
      }
    },
    [setViewState]
  )

  // Clear search and marker
  const clearSearch = useCallback(() => {
    setSearchValue("")
    setSelectedLocation(null)
    setPlaceSelected(false)
    setSelectedPlaceId(null)
    setSearchError(false)
    setErrorMessage("")
    setIsSearchExpanded(false)
  }, [])

  // Fetch place details when a place is selected
  const {
    data: placeDetails,
    isLoading: isLoadingPlaceDetails,
    error: placeDetailsError,
  } = usePlaceDetails(selectedPlaceId)

  // Navigate to place when details are loaded
  useEffect(() => {
    if (placeDetails && selectedPlaceId) {
      const lat = placeDetails.location.latitude
      const lng = placeDetails.location.longitude
      navigateToCoordinates(lat, lng)
      setSelectedPlaceId(null) // Reset after navigation
    }
  }, [placeDetails, selectedPlaceId, navigateToCoordinates])

  // Validate lat/lng coordinates
  const validateLatLng = (
    input: string
  ): {
    isValid: boolean
    error?: string
    coordinates?: { lat: number; lng: number }
  } => {
    // If input is empty, it's valid (no error shown)
    if (!input.trim()) {
      return { isValid: true }
    }

    // Remove whitespace
    const cleaned = input.trim()

    // Split by comma or space
    const parts = cleaned.split(/[,\s]+/).filter((p) => p.length > 0)

    if (parts.length === 0) {
      return { isValid: false, error: "Enter coordinates" }
    }

    if (parts.length === 1) {
      return { isValid: false, error: "Enter both lat and lng" }
    }

    if (parts.length > 2) {
      return { isValid: false, error: "Too many values. Use: lat, lng" }
    }

    const lat = parseFloat(parts[0])
    const lng = parseFloat(parts[1])

    // Validate that they are numbers
    if (isNaN(lat) || isNaN(lng)) {
      return { isValid: false, error: "Invalid numbers" }
    }

    // Validate ranges
    if (Math.abs(lat) > 90) {
      return { isValid: false, error: "Latitude must be between -90 and 90" }
    }

    if (Math.abs(lng) > 180) {
      return { isValid: false, error: "Longitude must be between -180 and 180" }
    }

    return { isValid: true, coordinates: { lat, lng } }
  }

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    setSelectedIndex(-1)
    setPlaceSelected(false) // Reset place selected flag when user types

    // Validate coordinates if it looks like coordinates
    if (looksLikeCoordinates(value)) {
      const validation = validateLatLng(value)
      setSearchError(!validation.isValid && value.trim().length > 0)
      setErrorMessage(validation.error || "")
    } else {
      // Clear coordinate errors for place searches
      setSearchError(false)
      setErrorMessage("")
    }

    // Clear marker if search is cleared
    if (!value.trim() && selectedLocation) {
      setSelectedLocation(null)
    }
  }

  // Handle coordinate submission
  const handleCoordinateSubmit = useCallback(() => {
    if (!searchValue.trim()) {
      return
    }

    const validation = validateLatLng(searchValue)

    if (!validation.isValid || !validation.coordinates) {
      setSearchError(true)
      setErrorMessage(validation.error || "Invalid coordinates")
      return
    }

    const { lat, lng } = validation.coordinates
    navigateToCoordinates(lat, lng)
  }, [searchValue, navigateToCoordinates])

  // Handle place selection from autocomplete
  const handlePlaceSelect = useCallback(
    (prediction: google.maps.places.AutocompletePrediction) => {
      // Update search value to show selected place
      setSearchValue(prediction.description)
      setPlaceSelected(true) // Mark that a place was selected

      // Fetch place details using the hook
      setSelectedPlaceId(prediction.place_id)
    },
    []
  )

  // Handle search icon click
  const handleSearchIconClick = () => {
    console.log("Search icon clicked, expanding search")
    setIsSearchExpanded(true)
  }

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()

        // If there's a selected prediction, select it
        if (selectedIndex >= 0 && autocompleteResults[selectedIndex]) {
          handlePlaceSelect(autocompleteResults[selectedIndex])
        } else if (autocompleteResults.length > 0) {
          // Select first result if available
          handlePlaceSelect(autocompleteResults[0])
        } else if (looksLikeCoordinates(searchValue)) {
          // Submit coordinates
          handleCoordinateSubmit()
        }
      } else if (e.key === "Escape") {
        clearSearch()
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        if (autocompleteResults.length > 0) {
          setSelectedIndex((prev) =>
            prev < autocompleteResults.length - 1 ? prev + 1 : prev
          )
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (autocompleteResults.length > 0) {
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        }
      }
    },
    [
      selectedIndex,
      autocompleteResults,
      searchValue,
      handlePlaceSelect,
      handleCoordinateSubmit,
    ]
  )

  // Focus input when expanded
  useEffect(() => {
    if (isSearchExpanded) {
      // Use setTimeout to ensure the input is rendered before focusing
      setTimeout(() => {
        const input = searchInputRef.current?.querySelector("input")
        if (input) {
          input.focus()
          input.select()
        }
      }, 100)
    }
  }, [isSearchExpanded])

  // Handle click outside to collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isSearchExpanded &&
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        // Only collapse if search value is empty
        if (!searchValue.trim()) {
          setIsSearchExpanded(false)
          setSearchError(false)
          setErrorMessage("")
        }
      }
    }

    if (isSearchExpanded) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => {
        document.removeEventListener("mousedown", handleClickOutside)
      }
    }
  }, [isSearchExpanded, searchValue])

  // Handle errors
  useEffect(() => {
    if (autocompleteError) {
      console.error("[MapSearchBar] Autocomplete error:", autocompleteError)
      // Don't show error to user for autocomplete failures, just log it
    }
    if (placeDetailsError) {
      console.error("[MapSearchBar] Place details error:", placeDetailsError)
      setSearchError(true)
      setErrorMessage("Failed to get place details")
    }
  }, [autocompleteError, placeDetailsError])

  if (!isProjectPage) return null

  const isPlaceSearch = !looksLikeCoordinates(searchValue)
  const hasMinChars = trimmedInput.length >= 3
  const showAutocomplete =
    isSearchExpanded &&
    isPlaceSearch &&
    searchValue.trim().length > 0 &&
    !placeSelected
  const showMinCharsMessage =
    showAutocomplete && !hasMinChars && !isLoadingAutocomplete

  return (
    <>
      {/* Icon Layer for search marker */}
      {iconData.length > 0 && (
        <MapLayer
          id="search-marker-layer"
          order={100}
          type={IconLayer}
          data={iconData}
          getPosition={(d: { coordinates: number[] }) =>
            [d.coordinates[0], d.coordinates[1]] as [number, number]
          }
          getIcon={() => ({
            url: "https://iconify-markers.deno.dev/?fill=3B82F6&iconColor=FFFFFF&size=36",
            width: 128,
            height: 128,
            anchorY: 128,
          })}
          getSize={36}
          sizeScale={1}
        />
      )}

      <div
        ref={searchContainerRef}
        className={cn(
          "flex items-center",
          grouped ? "relative" : "absolute top-3 left-3 z-[1001] pointer-events-auto gap-1"
        )}
      >
        {isSearchExpanded ? (
          <div
            ref={searchInputRef}
            className="relative"
            onBlur={(e) => {
              // Don't collapse on blur if there's a value or if clicking inside
              const currentTarget = e.currentTarget
              const relatedTarget = e.relatedTarget as Node | null
              if (
                !searchValue.trim() &&
                relatedTarget &&
                !currentTarget.contains(relatedTarget)
              ) {
                setIsSearchExpanded(false)
                setSearchError(false)
                setErrorMessage("")
              }
            }}
          >
            <div className="relative">
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search location or lat, lng"
                value={searchValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleSearchChange(e.target.value)
                }
                onKeyDown={handleKeyDown}
                className={cn(
                  "w-60 min-w-60 max-w-60 transition-all pl-10 pr-10 h-9",
                  grouped
                    ? "border-0 rounded-none bg-transparent focus:ring-0 focus:outline-none"
                    : "rounded-md border",
                  searchError
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                    : ""
                )}
              />
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-scale-900 dark:text-scale-100 pointer-events-none">
                <i
                  className={cn(
                    Icons.search,
                    "text-scale-900 dark:text-scale-100"
                  )}
                />
              </div>
              {(searchValue || selectedLocation) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    clearSearch()
                  }}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-scale-600 dark:text-scale-400 hover:text-scale-900 dark:hover:text-scale-100 transition-colors pointer-events-auto"
                  aria-label="Clear search"
                >
                  <i
                    className={cn(
                      "icon-[ph--x-circle-duotone]",
                      "text-scale-900"
                    )}
                  />
                </button>
              )}
            </div>
            {searchError && errorMessage && (
              <div className="absolute top-full left-0 mt-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 bg-white dark:bg-scale-800 border border-red-200 dark:border-red-800 rounded-md shadow-sm z-50 whitespace-nowrap">
                {errorMessage}
              </div>
            )}
            {showAutocomplete && (
              <AutocompleteDropdown
                predictions={autocompleteResults}
                isOpen={showAutocomplete}
                selectedIndex={selectedIndex}
                onSelect={handlePlaceSelect}
                onClose={() => {}}
                isLoading={isLoadingAutocomplete || isLoadingPlaceDetails}
                anchorElement={searchInputRef.current}
                showMinCharsMessage={showMinCharsMessage}
              />
            )}
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="tiny"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleSearchIconClick()
                }}
                className={cn(
                  "text-scale-900 dark:text-scale-100 hover:bg-brand-500/50 hover:text-brand-600",
                  grouped
                    ? "bg-transparent border-0 rounded-none h-9 w-9"
                    : "bg-scale-200 dark:hover:bg-scale-700 border-scale-700 dark:border-scale-600"
                )}
                icon={Icons.search + " text-scale-900 dark:text-scale-100"}
                aria-label="Search location or coordinates"
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Search location or coordinates</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </>
  )
}

export default MapSearchBar
