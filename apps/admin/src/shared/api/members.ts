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
  accessUntil: string | null
  createdAt: string
  watchedCount: number
  inProgressCount: number
  lastWatchedAt: string | null
  lastWatchedVideo: { id: string; title: string } | null
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

export type PendingUser = {
  userId: string
  email: string
  firstname?: string | null
  lastname?: string | null
  createdAt: string
  lastSeenAt: string
}

export const listPendingUsers = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{ data: PendingUser[]; total: number }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/pending-users`,
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

export type MemberProgress = {
  member: {
    id: string
    userId: string
    email: string
    firstname?: string | null
    lastname?: string | null
    status: string
    roleName: string
    isOwner: boolean
    accessUntil: string | null
    createdAt: string
  }
  summary: {
    totalVideos: number
    completedCount: number
    inProgressCount: number
    lastWatchedAt: string | null
    lastWatchedVideo: { id: string; title: string } | null
  }
  courses: Array<{
    id: string
    title: string
    slug: string
    totalVideos: number
    completedCount: number
    inProgressCount: number
  }>
  recentActivity: Array<{
    videoId: string
    videoTitle: string
    status: "watched" | "in-progress"
    position: number
    completed: boolean
    watchedAt: string
  }>
}

export const getMemberProgress = async (params: {
  workspaceId: string
  userId: string
}) => {
  return await getApiClient().request<MemberProgress>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/progress`,
  })
}
