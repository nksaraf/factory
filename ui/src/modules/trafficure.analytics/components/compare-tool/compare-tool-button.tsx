import { useState } from "react"
import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"
import { CompareToolModal } from "./compare-tool-modal"
import { cn } from "@rio.js/ui/lib/utils"

interface CompareToolButtonProps {
  className?: string
}

export function CompareToolButton({ className }: CompareToolButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 px-3 text-xs sm:text-sm font-medium",
          "bg-scale-100 hover:bg-scale-200 border-scale-600",
          "text-scale-1200 hover:text-scale-1200",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Icon icon="icon-[ph--chart-line-up]" className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">Compare</span>
        </div>
      </Button>
      <CompareToolModal open={open} onOpenChange={setOpen} />
    </>
  )
}




