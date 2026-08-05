import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AttendanceSession = ApiTypes.AttendanceSessionOutputDtoOutput
export type SessionRoster = ApiTypes.SessionRosterOutputDtoOutput
export type RosterEntry = SessionRoster["roster"][number]
export type CreateSessionInput = ApiTypes.CreateAttendanceSessionInput
export type SessionList = ApiTypes.ListSessionsOutputOutput
export type AttendanceOverview = ApiTypes.AttendanceOverviewOutputOutput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/attendance`

export const listSessions = async (params: {
  workspaceId: string
  from?: string
  to?: string
  groupId?: string
  curPage?: number
  perPage?: number
}): Promise<SessionList> =>
  await getApiClient().request<SessionList>({
    method: "get",
    url: `${base(params.workspaceId)}/sessions`,
    params: {
      from: params.from,
      to: params.to,
      groupId: params.groupId,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

export const createAttendanceSession = async (params: {
  workspaceId: string
  data: CreateSessionInput
}): Promise<AttendanceSession> =>
  await getApiClient().request<AttendanceSession, CreateSessionInput>({
    method: "post",
    url: `${base(params.workspaceId)}/sessions`,
    data: params.data,
  })

export const getSessionRoster = async (params: {
  workspaceId: string
  sessionId: string
}): Promise<SessionRoster> =>
  await getApiClient().request<SessionRoster>({
    method: "get",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}/roster`,
  })

export const markAttendance = async (params: {
  workspaceId: string
  sessionId: string
  userIds: string[]
}): Promise<SessionRoster> =>
  await getApiClient().request<SessionRoster, { userIds: string[] }>({
    method: "post",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}/records`,
    data: { userIds: params.userIds },
  })

export const unmarkAttendance = async (params: {
  workspaceId: string
  sessionId: string
  userId: string
}): Promise<SessionRoster> =>
  await getApiClient().request<SessionRoster>({
    method: "delete",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}/records/${params.userId}`,
  })

export const deleteSession = async (params: {
  workspaceId: string
  sessionId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}`,
  })

export const getAttendanceOverview = async (params: {
  workspaceId: string
  days?: number
}): Promise<AttendanceOverview> =>
  await getApiClient().request<AttendanceOverview>({
    method: "get",
    url: `${base(params.workspaceId)}/overview`,
    params: { days: params.days },
  })
