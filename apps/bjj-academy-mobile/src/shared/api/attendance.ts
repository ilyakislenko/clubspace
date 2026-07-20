import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type AttendanceSession = ApiTypes.AttendanceSessionOutputDtoOutput
export type SessionRoster = ApiTypes.SessionRosterOutputDtoOutput
export type RosterEntry = SessionRoster["roster"][number]
export type CreateSessionInput = ApiTypes.CreateAttendanceSessionInput
export type MyAttendance = ApiTypes.MyAttendanceOutputOutput

const base = (workspaceId: string) =>
  `/workspaces/${workspaceId}/attendance`

// Resolve-or-create the session for an occurrence (scheduled slot+date,
// ad-hoc, or event). Idempotent server-side, so tapping "Take attendance"
// twice returns the same session.
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

// Mark the given members present. Incremental + idempotent — safe to call
// per arrival. Returns the fresh roster.
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

export type SelfCheckInResult = ApiTypes.SelfCheckInOutputOutput

// Member self-check-in with the code the coach shows.
export const selfCheckIn = async (params: {
  workspaceId: string
  code: string
}): Promise<SelfCheckInResult> =>
  await getApiClient().request<SelfCheckInResult, { code: string }>({
    method: "post",
    url: `${base(params.workspaceId)}/check-in`,
    data: { code: params.code },
  })

// The current member's own attendance in this workspace.
export const getMyAttendance = async (params: {
  workspaceId: string
  from?: string
  to?: string
  curPage?: number
  perPage?: number
}): Promise<MyAttendance> =>
  await getApiClient().request<MyAttendance>({
    method: "get",
    url: `${base(params.workspaceId)}/me`,
    params: {
      from: params.from,
      to: params.to,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })
