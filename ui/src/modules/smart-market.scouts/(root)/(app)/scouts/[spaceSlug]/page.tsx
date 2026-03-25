import { useParams } from "react-router"

import { ScoutProject } from "./scout-project"

export default function ScoutsPage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>()

  return <ScoutProject spaceSlug={spaceSlug ?? null} />
}
