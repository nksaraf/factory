// import { MyProjects } from "~/src/routes/(authenticated)/(window)/org/projects/project-manager"

import { DashboardPage } from "@rio.js/app-ui/components/dashboard-page"
import { Icons } from "@rio.js/ui/icon"

export default function ProjectsPage() {
  return (
    <DashboardPage
      title="My Projects"
      icon={Icons.dashboard}
      description="Manage your projects and team members"
      backgroundImage="/map.webp"
    >
      {/* <MyProjects /> */}
    </DashboardPage>
  )
}
