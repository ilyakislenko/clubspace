import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type WorkspaceSchedule = ApiTypes.GetWorkspaceScheduleOutputOutput
export type ScheduleSession = WorkspaceSchedule["sessions"][number]
export type ScheduleEvent = WorkspaceSchedule["events"][number]

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

const slotBase = (p: { workspaceId: string; groupId: string; slotId: string }) =>
  `/workspaces/${p.workspaceId}/groups/${p.groupId}/schedule/slots/${p.slotId}`

export type MoveOccurrenceResult = ApiTypes.MoveGroupOccurrenceOutputOutput

// «Только это занятие»: one dated class moves (or comes back to its original
// place — the server then removes the one-off and the cancellation).
export const moveGroupOccurrence = async (params: {
  workspaceId: string
  groupId: string
  slotId: string
  sessionDate: string
  data: ApiTypes.MoveGroupOccurrenceInput
}): Promise<MoveOccurrenceResult> =>
  await getApiClient().request<
    MoveOccurrenceResult,
    ApiTypes.MoveGroupOccurrenceInput
  >({
    method: "post",
    url: `${slotBase(params)}/occurrences/${params.sessionDate}/move`,
    data: params.data,
  })

export type SplitSlotResult = ApiTypes.SplitGroupSlotOutputOutput

// «Это и все следующие»: the weekly slot changes from `fromDate` on; earlier
// classes keep the old time.
export const splitGroupSlot = async (params: {
  workspaceId: string
  groupId: string
  slotId: string
  data: ApiTypes.SplitGroupSlotInput
}): Promise<SplitSlotResult> =>
  await getApiClient().request<SplitSlotResult, ApiTypes.SplitGroupSlotInput>({
    method: "post",
    url: `${slotBase(params)}/split`,
    data: params.data,
  })
