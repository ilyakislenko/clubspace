import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AddMemberResponse = ApiTypes.AddWorkspaceMemberOutputOutput

export type WorkspaceMember =
  ApiTypes.ListWorkspaceMembersOutputOutput["data"][number]

// Exactly one of `email` (add/invite by address) or `userId` (approve a
// PENDING join request — the only way to approve a child profile, which has
// no e-mail).
export type AddMemberBody = { email: string } | { userId: string }

export const addWorkspaceMember = async (params: {
  workspaceId: string
  data: AddMemberBody
}) => {
  return await getApiClient().request<AddMemberResponse, AddMemberBody>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members`,
    data: params.data,
  })
}

export type AddDependentInput = ApiTypes.AddWorkspaceDependentInput
export type AddDependentResult = ApiTypes.AddWorkspaceDependentOutputOutput
export type GuardianRelation = NonNullable<AddDependentInput["relation"]>
export type MemberGuardian = WorkspaceMember["guardians"][number]

// Club-side child profile: the child becomes an ACTIVE member right away and
// the named guardian confirms the link in the app.
export const addWorkspaceDependent = async (params: {
  workspaceId: string
  data: AddDependentInput
}) => {
  return await getApiClient().request<AddDependentResult, AddDependentInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members/dependents`,
    data: params.data,
  })
}

export type ListMembersQuery = NonNullable<ApiTypes.ListMembersData["query"]>
export type MemberSort = NonNullable<ListMembersQuery["sort"]>
// Dashboard retention segments (?filter= deep-links), counted server-side.
export type MemberAccessFilter = NonNullable<ListMembersQuery["access"]>
export type MembersPage = ApiTypes.ListWorkspaceMembersOutputOutput

// One page of the roster (server default 50, at most 200), filtered and
// ordered server-side.
export const listWorkspaceMembers = async (
  params: { workspaceId: string } & ListMembersQuery,
) => {
  return await getApiClient().request<MembersPage>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members`,
    params: {
      curPage: params.curPage,
      perPage: params.perPage,
      q: params.q,
      access: params.access,
      staffOnly: params.staffOnly,
      sort: params.sort,
    },
  })
}

// Every staff member and the owner, page by page — for the coach / manager
// pickers (a club has a handful). Students are never downloaded whole: pick
// them with MemberSearchPicker (server-side `q`).
export const listAllStaffMembers = async (params: {
  workspaceId: string
}): Promise<WorkspaceMember[]> => {
  const perPage = 200
  const all: WorkspaceMember[] = []
  for (let curPage = 1; ; curPage++) {
    const page = await listWorkspaceMembers({
      workspaceId: params.workspaceId,
      staffOnly: true,
      curPage,
      perPage,
    })
    all.push(...page.data)
    if (page.data.length < perPage || all.length >= page.total) return all
  }
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

export type RejectPendingMemberInput = ApiTypes.RejectPendingMemberInput

// Declines a join request; the applicant is notified, with the comment when
// one is given.
export const rejectPendingMember = async (params: {
  workspaceId: string
  userId: string
  comment?: string
}) => {
  return await getApiClient().request<{ status: "rejected" }, RejectPendingMemberInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/reject`,
    data: params.comment ? { comment: params.comment } : {},
  })
}

export type MemberAttendance = ApiTypes.GetMemberAttendanceOutputOutput

export const getMemberAttendance = async (params: {
  workspaceId: string
  userId: string
  from?: string
  to?: string
  curPage?: number
  perPage?: number
}): Promise<MemberAttendance> => {
  return await getApiClient().request<MemberAttendance>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/attendance`,
    params: {
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(params.curPage ? { curPage: params.curPage } : {}),
      ...(params.perPage ? { perPage: params.perPage } : {}),
    },
  })
}

export type MemberAchievements = ApiTypes.MemberAchievementsOutputOutput

export const getMemberAchievements = async (params: {
  workspaceId: string
  userId: string
}): Promise<MemberAchievements> => {
  return await getApiClient().request<MemberAchievements>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/achievements`,
  })
}

export type MyMembership = ApiTypes.GetMyWorkspaceMembershipOutputOutput

export const getMyMembership = async (params: {
  workspaceId: string
}): Promise<MyMembership> => {
  return await getApiClient().request<MyMembership>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/me`,
  })
}

export const updateMemberProfile = async (params: {
  workspaceId: string
  userId: string
  firstname?: string | null
  lastname?: string | null
  email?: string
  phone?: string | null
  /** YYYY-MM-DD, or null to clear it. */
  dateOfBirth?: string | null
}) => {
  const { workspaceId, userId, ...patch } = params
  return await getApiClient().request<
    ApiTypes.UpdateMemberProfileOutputOutput,
    typeof patch
  >({
    method: "patch",
    url: `/workspaces/${workspaceId}/members/${userId}/profile`,
    data: patch,
  })
}

export const updateMemberAccess = async (params: {
  workspaceId: string
  userId: string
  /** ISO datetime, or null to clear the deadline. */
  accessUntil: string | null
}) => {
  return await getApiClient().request<
    { userId: string; accessUntil: string | null },
    { accessUntil: string | null }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/access`,
    data: { accessUntil: params.accessUntil },
  })
}

export const updateMemberNotes = async (params: {
  workspaceId: string
  userId: string
  /** null or empty clears the note. */
  notes: string | null
}) => {
  return await getApiClient().request<
    { userId: string; notes: string | null },
    { notes: string | null }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/notes`,
    data: { notes: params.notes },
  })
}

export type MemberProgress = ApiTypes.GetMemberProgressOutputOutput

export const getMemberProgress = async (params: {
  workspaceId: string
  userId: string
}) => {
  return await getApiClient().request<MemberProgress>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/progress`,
  })
}
