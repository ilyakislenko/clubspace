import { getSdkClient } from "./client"
import { getMyWorkspaces, type GetMyWorkspacesOutputOutput } from "../sdk"

export type WorkspaceSummary = GetMyWorkspacesOutputOutput["data"][number]

export const fetchWorkspaces = async (
  params: { curPage?: number; perPage?: number } = {}
): Promise<WorkspaceSummary[]> => {
  const response = await getMyWorkspaces({
    body: params,
    client: getSdkClient(),
    throwOnError: true,
  })

  return response.data.data ?? []
}
