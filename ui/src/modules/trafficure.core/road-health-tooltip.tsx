import { AnimatePresence, motion } from "motion/react"
import { RoadHealthTooltipCard } from "./road-health-tooltip-card"
import { type TrafficRoadProperties } from "./traffic-utils"

interface RoadHealthTooltipProps {
  properties: TrafficRoadProperties
  x: number
  y: number
}

export function RoadHealthTooltip({
  properties,
  x,
  y,
}: RoadHealthTooltipProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="pointer-events-none absolute z-[99999]"
        style={{
          left: x + 15,
          top: y + 15,
        }}
      >
        <div className="relative w-[240px]">
          {/* <RoadHealthContent
            properties={properties}
            renderSummarySection={false}
          /> */}
          <RoadHealthTooltipCard
            properties={properties}
            renderSummarySection={false}
            renderButtons={false}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  )
}