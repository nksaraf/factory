import { EmptyState, PlaneHeader } from "@/components/factory"

export default function IncidentsPage() {
  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Incident Console"
        description="Active and resolved operational incidents"
      />
      <EmptyState
        icon="icon-[ph--warning-diamond-duotone]"
        title="Incident management coming soon"
        description="This will include severity tracking, incident timelines, responder assignment, affected services mapping, and postmortem linking. The Incident entity is being added to the Fleet schema."
      />
    </div>
  )
}
