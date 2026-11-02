import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AttendanceSession = ApiTypes.AttendanceSessionOutputDtoOutput
export type SessionRoster = ApiTypes.SessionRosterOutputDtoOutput
export type RosterEntry = SessionRoster["roster"][number]
// The abonement a visit is (or would be) spent on, with its scope.
export type VisitAbonement = NonNullable<RosterEntry["abonement"]>
export type AbonementOverride = NonNullable<
  ApiTypes.MarkRecordsInputDto["abonements"]
>[number]
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

// An existing session by id — how a personal session is opened (it has no
// slot to resolve-or-create from).
export const getAttendanceSession = async (params: {
  workspaceId: string
  sessionId: string
}): Promise<AttendanceSession> =>
  await getApiClient().request<AttendanceSession>({
    method: "get",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}`,
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
// per arrival. Returns the fresh roster. `abonements` overrides the default
// abonement for the listed members only.
export const markAttendance = async (params: {
  workspaceId: string
  sessionId: string
  userIds: string[]
  abonements?: AbonementOverride[]
}): Promise<SessionRoster> =>
  await getApiClient().request<SessionRoster, ApiTypes.MarkRecordsInputDto>({
    method: "post",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}/records`,
    data: markRecordsBody(params.userIds, params.abonements),
  })

// The mark body, shared with the offline outbox replay: no `abonements` key
// when nothing is overridden, so the request is the same as before.
export const markRecordsBody = (
  userIds: string[],
  abonements?: AbonementOverride[],
): ApiTypes.MarkRecordsInputDto =>
  abonements && abonements.length > 0 ? { userIds, abonements } : { userIds }

// Move an already marked visit to another of the member's eligible
// abonements. Returns the fresh roster.
export const changeRecordAbonement = async (params: {
  workspaceId: string
  sessionId: string
  userId: string
  subscriptionId: string
}): Promise<SessionRoster> =>
  await getApiClient().request<
    SessionRoster,
    ApiTypes.ChangeRecordAbonementInputDto
  >({
    method: "put",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}/records/${params.userId}/abonement`,
    data: { subscriptionId: params.subscriptionId },
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

// Save the coach's note on a session (null clears it). Returns the session.
export const updateSession = async (params: {
  workspaceId: string
  sessionId: string
  notes: string | null
}): Promise<AttendanceSession> =>
  await getApiClient().request<AttendanceSession, { notes: string | null }>({
    method: "patch",
    url: `${base(params.workspaceId)}/sessions/${params.sessionId}`,
    data: { notes: params.notes },
  })

export type SelfCheckInResult = ApiTypes.SelfCheckInOutputOutput
export type SelfCheckInPreview = ApiTypes.SelfCheckInPreviewOutputDtoOutput

// What a self-check-in with this code would do, without writing anything:
// the session, whether the member is already marked, and which abonements
// the visit can be spent on (default first).
export const previewSelfCheckIn = async (params: {
  workspaceId: string
  code: string
}): Promise<SelfCheckInPreview> =>
  await getApiClient().request<
    SelfCheckInPreview,
    ApiTypes.SelfCheckInPreviewInputDto
  >({
    method: "post",
    url: `${base(params.workspaceId)}/check-in/preview`,
    data: { code: params.code },
  })

// Member self-check-in with the code the coach shows. `subscriptionId`
// picks the abonement; omitted = the server's default.
export const selfCheckIn = async (params: {
  workspaceId: string
  code: string
  subscriptionId?: string
}): Promise<SelfCheckInResult> =>
  await getApiClient().request<SelfCheckInResult, ApiTypes.SelfCheckInBody>({
    method: "post",
    url: `${base(params.workspaceId)}/check-in`,
    data: params.subscriptionId
      ? { code: params.code, subscriptionId: params.subscriptionId }
      : { code: params.code },
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

export type AttendanceOverview = ApiTypes.AttendanceOverviewOutputOutput

// Staff: the classes held, check-ins and distinct members over the last `days`
// (30 by default) — a coach's own groups unless the club lets coaches see all.
export const getAttendanceOverview = async (params: {
  workspaceId: string
  days?: number
}): Promise<AttendanceOverview> =>
  await getApiClient().request<AttendanceOverview>({
    method: "get",
    url: `${base(params.workspaceId)}/overview`,
    params: { days: params.days },
  })
