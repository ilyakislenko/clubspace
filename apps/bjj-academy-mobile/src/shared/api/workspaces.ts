import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type WorkspaceSummary =
  ApiTypes.GetMyWorkspacesOutputOutput["data"][number]

export const fetchMyWorkspaces = async () => {
  return await getApiClient().request<ApiTypes.GetMyWorkspacesOutputOutput>({
    method: "post",
    url: "/get-my-workspaces",
    data: {},
  })
}
