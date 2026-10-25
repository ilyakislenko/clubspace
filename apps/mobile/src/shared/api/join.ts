import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type JoinWorkspaceResult = ApiTypes.JoinWorkspaceOutputOutput
export type JoinRequest =
  ApiTypes.ListMyJoinRequestsOutputOutput["data"][number]

// A member joins a club by its code. Names are sent only when the account has
// none yet (the caller trims and drops empty ones).
export const joinWorkspaceByCode = async (data: ApiTypes.JoinWorkspaceInput) => {
  return await getApiClient().request<
    JoinWorkspaceResult,
    ApiTypes.JoinWorkspaceInput
  >({
    method: "post",
    url: "/workspaces/join",
    data,
  })
}

// Requests to clubs the member is not (yet) in: awaiting approval or rejected.
export const listMyJoinRequests = async () => {
  return await getApiClient().request<ApiTypes.ListMyJoinRequestsOutputOutput>({
    method: "get",
    url: "/me/join-requests",
  })
}
