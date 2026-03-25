import { useParams } from "react-router"

import { WorkspaceContent } from "../../../../../../components/workspace-content"

export default function ResourcePage() {
  const { resourceId } = useParams<{ resourceId: string }>()
  return <WorkspaceContent resourceId={resourceId} />
}
