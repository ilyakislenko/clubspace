import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type WorkspaceInvite = ApiTypes.GetWorkspaceInviteOutputOutput

// Staff read: the club's join code, link and QR for showing on a coach's phone.
export const getWorkspaceInvite = async (params: {
  workspaceId: string
}): Promise<WorkspaceInvite> =>
  await getApiClient().request<WorkspaceInvite>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/invite`,
  })
