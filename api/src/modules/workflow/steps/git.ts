/**
 * Git host steps — branch creation, PR comments, etc.
 */

import { getGitHostAdapter } from "../../../adapters/adapter-registry"
import type {
  GitHostAdapterConfig,
  GitHostType,
} from "../../../adapters/git-host-adapter"

export async function createBranch(input: {
  repoFullName: string
  branchName: string
  fromRef: string
  hostType: GitHostType
  hostConfig: GitHostAdapterConfig
}) {
  "use step"
  const adapter = getGitHostAdapter(input.hostType, input.hostConfig)
  return adapter.createBranch(
    input.repoFullName,
    input.branchName,
    input.fromRef
  )
}

export async function postPRComment(input: {
  repoFullName: string
  prNumber: number
  body: string
  hostType: GitHostType
  hostConfig: GitHostAdapterConfig
}) {
  "use step"
  const adapter = getGitHostAdapter(input.hostType, input.hostConfig)
  return adapter.postPRComment(input.repoFullName, input.prNumber, input.body)
}
