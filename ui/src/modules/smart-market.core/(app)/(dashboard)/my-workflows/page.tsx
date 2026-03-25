import { DashboardPage } from "@rio.js/app-ui/components/dashboard-page"
import { Icons } from "@rio.js/ui/icon"
import { WorkflowsView } from "@rio.js/workflows-ui/components/workflows-view"

export default function ProjectsPage() {
  return (
    <DashboardPage
      title="My Workflows"
      icon={Icons.workflow}
      description="Manage your workflows"
      backgroundImage="/map.webp"
    >
      <WorkflowsView />
    </DashboardPage>
  )
}
