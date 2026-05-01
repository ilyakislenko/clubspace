import { getApiClient } from "./client"

export type AddMemberResponse = {
  id: string
  userId: string
  email: string
  isNew: boolean
}

export const addWorkspaceMember = async (params: {
  workspaceId: string
  email: string
}) => {
  return await getApiClient().request<AddMemberResponse, { email: string }>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members`,
    data: { email: params.email },
  })
}
