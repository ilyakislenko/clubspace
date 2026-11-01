import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Invitation = ApiTypes.ListMyInvitationsOutputOutput["data"][number]
export type AcceptInvitationResult =
  ApiTypes.AcceptWorkspaceInvitationOutputOutput

// Offers from clubs to this account. Not a membership yet: the member is in the
// club only after accepting.
export const listMyInvitations = async (): Promise<Invitation[]> => {
  const response =
    await getApiClient().request<ApiTypes.ListMyInvitationsOutputOutput>({
      method: "get",
      url: "/me/invitations",
    })
  return response.data ?? []
}

export const acceptInvitation = async (invitationId: string) => {
  return await getApiClient().request<AcceptInvitationResult>({
    method: "post",
    url: `/me/invitations/${invitationId}/accept`,
  })
}

export const declineInvitation = async (invitationId: string) => {
  return await getApiClient().request<ApiTypes.DeclineWorkspaceInvitationOutputOutput>(
    {
      method: "post",
      url: `/me/invitations/${invitationId}/decline`,
    },
  )
}
