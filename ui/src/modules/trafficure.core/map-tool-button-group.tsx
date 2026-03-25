import { cn } from "@rio.js/ui/lib/utils"

type ToolButtonGroupPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-right"

interface MapToolButtonGroupProps {
  children: React.ReactNode
  className?: string
  position?: ToolButtonGroupPosition
}

const positionClasses: Record<ToolButtonGroupPosition, string> = {
  "top-left": "top-3 left-3",
  "top-center": "top-3 left-1/2 -translate-x-1/2",
  "top-right": "top-3 right-3",
  "bottom-left": "bottom-3 left-3",
  "bottom-right": "bottom-3 right-3",
}

/**
 * A button group container for map tools that can be positioned at common edges of the map.
 * Children rendered within become part of the visual group.
 * @param position - Position of the button group:
 * "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-right" (default: "top-left")
 */
export function MapToolButtonGroup({
  children,
  className,
  position = "top-left",
}: MapToolButtonGroupProps) {
  return (
    <div
      className={cn(
        "absolute z-[1001] pointer-events-auto",
        positionClasses[position],
        "flex items-stretch",
        "[&>*]:rounded-none [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md",
        "[&>*]:border-r [&>*]:border-scale-600 [&>*:last-child]:border-r-0",
        "rounded-md shadow-md",
        "bg-card/80 backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>
  )
}

