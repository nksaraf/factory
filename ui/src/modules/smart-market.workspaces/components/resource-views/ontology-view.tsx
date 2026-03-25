import type { ResourceDetail } from "../../types"
import { ResourceStub } from "./resource-stub"

export default function OntologyView({
  resource,
}: {
  resource: ResourceDetail
}) {
  return (
    <ResourceStub
      resource={resource}
      icon="icon-[ph--brain-duotone]"
      description="Semantic schema editor with entities, properties, metrics, and glossary terms"
    />
  )
}
