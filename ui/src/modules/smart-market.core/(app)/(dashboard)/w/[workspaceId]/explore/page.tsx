import { useParams } from "react-router"

import { ExploreProject } from "./explore-project"

export default function ExplorePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return <ExploreProject workspaceId={workspaceId ?? null} />
}
