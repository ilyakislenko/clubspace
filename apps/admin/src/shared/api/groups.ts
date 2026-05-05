import { getApiClient } from "./client"

export type Gym = {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  groupCount: number
  createdAt: string
}

export type GroupCoach = {
  id: string
  email: string
  firstname: string | null
  lastname: string | null
}

export type GroupMemberRow = {
  userId: string
  email: string
  firstname: string | null
  lastname: string | null
  joinedAt: string
}

export type GroupSummary = {
  id: string
  name: string
  scheduleText: string | null
  gym: { id: string; name: string; address: string }
  coach: GroupCoach
  memberCount: number
  members: GroupMemberRow[]
  createdAt: string
}

export const listGyms = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{ data: Gym[]; total: number }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/gyms`,
  })
}

export const createGym = async (params: {
  workspaceId: string
  name: string
  address: string
}) => {
  return await getApiClient().request<
    { id: string; name: string; address: string },
    { name: string; address: string }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/gyms`,
    data: { name: params.name, address: params.address },
  })
}

export const listGroups = async (params: {
  workspaceId: string
  coachId?: string
}) => {
  const search = params.coachId ? `?coachId=${params.coachId}` : ""
  return await getApiClient().request<{
    data: GroupSummary[]
    total: number
  }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/groups${search}`,
  })
}

export const createGroup = async (params: {
  workspaceId: string
  name: string
  gymId: string
  coachId: string
  scheduleText?: string | null
  memberIds?: string[]
}) => {
  return await getApiClient().request<
    { id: string; name: string; gymId: string; coachId: string },
    {
      name: string
      gymId: string
      coachId: string
      scheduleText?: string | null
      memberIds?: string[]
    }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/groups`,
    data: {
      name: params.name,
      gymId: params.gymId,
      coachId: params.coachId,
      scheduleText: params.scheduleText ?? null,
      memberIds: params.memberIds ?? [],
    },
  })
}

export const updateGroup = async (params: {
  workspaceId: string
  groupId: string
  name?: string
  gymId?: string
  coachId?: string
  scheduleText?: string | null
}) => {
  const { workspaceId, groupId, ...patch } = params
  return await getApiClient().request<
    {
      id: string
      name: string
      gymId: string
      coachId: string
      scheduleText: string | null
    },
    typeof patch
  >({
    method: "patch",
    url: `/workspaces/${workspaceId}/groups/${groupId}`,
    data: patch,
  })
}

export const deleteGroup = async (params: {
  workspaceId: string
  groupId: string
}) => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}`,
  })
}

export const addGroupMember = async (params: {
  workspaceId: string
  groupId: string
  userId: string
}) => {
  return await getApiClient().request<
    { groupId: string; userId: string; joinedAt: string },
    { userId: string }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/members`,
    data: { userId: params.userId },
  })
}

export const removeGroupMember = async (params: {
  workspaceId: string
  groupId: string
  userId: string
}) => {
  return await getApiClient().request<{ status: "removed" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/members/${params.userId}`,
  })
}

export type Role = {
  id: string
  name: string
  superuser: boolean
  editable: boolean
}

export const listRoles = async () => {
  return await getApiClient().request<{ data: Role[] }>({
    method: "get",
    url: `/roles`,
  })
}

export const updateMemberRole = async (params: {
  workspaceId: string
  userId: string
  roleId: string
}) => {
  return await getApiClient().request<
    { userId: string; roleId: string; roleName: string },
    { roleId: string }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/role`,
    data: { roleId: params.roleId },
  })
}
