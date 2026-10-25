import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type WorkspaceInvite = ApiTypes.GetWorkspaceInviteOutputOutput

// `role` is the role name the server resolves (user | coach); `sendEmail`
// defaults to true on the server.
export type InviteMemberInput = ApiTypes.InviteWorkspaceMemberInput
export type InviteMemberResult = ApiTypes.InviteWorkspaceMemberOutputOutput

export const getWorkspaceInvite = async (params: {
  workspaceId: string
}): Promise<WorkspaceInvite> => {
  return await getApiClient().request<WorkspaceInvite>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/invite`,
  })
}

export const rotateWorkspaceJoinCode = async (params: {
  workspaceId: string
}): Promise<WorkspaceInvite> => {
  return await getApiClient().request<WorkspaceInvite>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/invite/rotate-code`,
  })
}

export const inviteWorkspaceMember = async (params: {
  workspaceId: string
  data: InviteMemberInput
}): Promise<InviteMemberResult> => {
  return await getApiClient().request<InviteMemberResult, InviteMemberInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members/invite`,
    data: params.data,
  })
}
