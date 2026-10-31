import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Offers the club sent to people who already have an account; they join once
// they accept in the app.
export type WorkspaceInvitation =
  ApiTypes.ListWorkspaceInvitationsOutputOutput["data"][number]

export const listWorkspaceInvitations = async (params: {
  workspaceId: string
}) =>
  await getApiClient().request<ApiTypes.ListWorkspaceInvitationsOutputOutput>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/invitations`,
  })

export const revokeWorkspaceInvitation = async (params: {
  workspaceId: string
  invitationId: string
}) =>
  await getApiClient().request<ApiTypes.RevokeWorkspaceInvitationOutputOutput>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/invitations/${params.invitationId}`,
  })
