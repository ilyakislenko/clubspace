import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type WorkspaceSchedule = ApiTypes.GetWorkspaceScheduleOutputOutput
export type ScheduleSession = WorkspaceSchedule["sessions"][number]

// from/to are YYYY-MM-DD club calendar days (inclusive).
export const getSchedule = async (params: {
  workspaceId: string
  from: string
  to: string
  directionId?: string
}): Promise<WorkspaceSchedule> =>
  await getApiClient().request<WorkspaceSchedule>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/schedule`,
    params: {
      from: params.from,
      to: params.to,
      directionId: params.directionId,
    },
  })
