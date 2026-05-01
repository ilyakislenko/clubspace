import { getApiClient } from "./client"

export type AddMemberResponse = {
  id: string
  userId: string
  email: string
  isNew: boolean
}

export type WorkspaceMember = {
  id: string
  userId: string
  email: string
  firstname?: string | null
  lastname?: string | null
  status: string
  roleName: string
  isOwner: boolean
  createdAt: string
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

export const listWorkspaceMembers = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{ data: WorkspaceMember[]; total: number }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members`,
  })
}

export const removeWorkspaceMember = async (params: {
  workspaceId: string
  userId: string
}) => {
  return await getApiClient().request<{ status: "removed" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}`,
  })
}
