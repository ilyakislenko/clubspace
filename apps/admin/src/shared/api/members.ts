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

export const listWorkspaceMembers = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{
    data: WorkspaceMember[]
    total: number
    workspaceVideoTotal: number
  }>({
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

export const rejectPendingMember = async (params: {
  workspaceId: string
  userId: string
}) => {
  return await getApiClient().request<{ status: "rejected" }, undefined>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/reject`,
  })
}

export type PendingUser = ApiTypes.ListPendingUsersOutputOutput["data"][number]

export const listPendingUsers = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{ data: PendingUser[]; total: number }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/pending-users`,
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

export type ImportMemberRow = {
  email: string
  firstname?: string | null
  lastname?: string | null
}

export type ImportMembersResult = ApiTypes.ImportMembersOutputOutput

export const importMembers = async (params: {
  workspaceId: string
  members: ImportMemberRow[]
}): Promise<ImportMembersResult> => {
  return await getApiClient().request<
    ImportMembersResult,
    { members: ImportMemberRow[] }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members/import`,
    data: { members: params.members },
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
