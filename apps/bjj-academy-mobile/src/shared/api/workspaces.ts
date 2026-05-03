import { getApiClient } from "./client"

export type WorkspaceSummary = {
  workspaceId: string
  key: string
  name: string
  type: string
  isActive: boolean
  accessUntil?: string | null
  accessExpired?: boolean
}

export const fetchMyWorkspaces = async () => {
  return await getApiClient().request<{
    data: WorkspaceSummary[]
    meta: { curPage: number; perPage: number; total: number }
  }>({
    method: "post",
    url: "/get-my-workspaces",
    data: {},
  })
}
