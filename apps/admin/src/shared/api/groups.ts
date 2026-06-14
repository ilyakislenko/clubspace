import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Gym = ApiTypes.ListGymsOutputOutput["data"][number]

export type GroupSummary = ApiTypes.ListGroupsOutputOutput["data"][number]

export type GroupCoach = GroupSummary["coach"]
export type GroupMemberRow = GroupSummary["members"][number]
export type GroupScheduleSlot = GroupSummary["slots"][number]
export type GroupScheduleException = GroupSummary["exceptions"][number]
export type GroupCoachAssignment = GroupSummary["coaches"][number]

export const addGroupCoach = async (params: {
  workspaceId: string
  groupId: string
  userId: string
}): Promise<{ groupId: string; userId: string; role: 'assistant' }> => {
  return await getApiClient().request<
    { groupId: string; userId: string; role: 'assistant' },
    { userId: string }
  >({
    method: 'post',
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/coaches`,
    data: { userId: params.userId },
  })
}

export const removeGroupCoach = async (params: {
  workspaceId: string
  groupId: string
  userId: string
}): Promise<{ status: 'removed' }> => {
  return await getApiClient().request<{ status: 'removed' }, undefined>({
    method: 'delete',
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/coaches/${params.userId}`,
  })
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
  timezone?: string | null
}) => {
  return await getApiClient().request<
    { id: string; name: string; address: string; timezone: string | null },
    { name: string; address: string; timezone?: string | null }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/gyms`,
    data: {
      name: params.name,
      address: params.address,
      timezone: params.timezone ?? null,
    },
  })
}

export const deleteGym = async (params: {
  workspaceId: string
  gymId: string
}) => {
  return await getApiClient().request<
    { status: "deleted"; orphanedGroupCount: number },
    undefined
  >({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/gyms/${params.gymId}`,
  })
}

export const updateGym = async (params: {
  workspaceId: string
  gymId: string
  name?: string
  address?: string
  timezone?: string | null
}) => {
  const { workspaceId, gymId, ...patch } = params
  return await getApiClient().request<
    { id: string; name: string; address: string; timezone: string | null },
    typeof patch
  >({
    method: "patch",
    url: `/workspaces/${workspaceId}/gyms/${gymId}`,
    data: patch,
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
  memberIds?: string[]
}) => {
  return await getApiClient().request<
    { id: string; name: string; gymId: string; coachId: string },
    {
      name: string
      gymId: string
      coachId: string
      memberIds?: string[]
    }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/groups`,
    data: {
      name: params.name,
      gymId: params.gymId,
      coachId: params.coachId,
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
}) => {
  const { workspaceId, groupId, ...patch } = params
  return await getApiClient().request<
    {
      id: string
      name: string
      gymId: string
      coachId: string
    },
    typeof patch
  >({
    method: "patch",
    url: `/workspaces/${workspaceId}/groups/${groupId}`,
    data: patch,
  })
}

// ---- Group schedule slots ----

export const createGroupSlot = async (params: {
  workspaceId: string
  groupId: string
  data: {
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom?: string | null
    effectiveUntil?: string | null
  }
}): Promise<GroupScheduleSlot> => {
  return await getApiClient().request<
    GroupScheduleSlot,
    typeof params.data
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/schedule/slots`,
    data: params.data,
  })
}

export const updateGroupSlot = async (params: {
  workspaceId: string
  groupId: string
  slotId: string
  data: Partial<{
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom: string | null
    effectiveUntil: string | null
  }>
}): Promise<GroupScheduleSlot> => {
  return await getApiClient().request<
    GroupScheduleSlot,
    typeof params.data
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/schedule/slots/${params.slotId}`,
    data: params.data,
  })
}

export const deleteGroupSlot = async (params: {
  workspaceId: string
  groupId: string
  slotId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/schedule/slots/${params.slotId}`,
  })
}

// ---- Group schedule exceptions (cancellations / vacations) ----

export const createGroupException = async (params: {
  workspaceId: string
  groupId: string
  data: {
    slotId?: string | null
    fromDate: string
    untilDate: string
    reason?: string | null
  }
}): Promise<GroupScheduleException> => {
  return await getApiClient().request<
    GroupScheduleException,
    typeof params.data
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/schedule/exceptions`,
    data: params.data,
  })
}

export const deleteGroupException = async (params: {
  workspaceId: string
  groupId: string
  exceptionId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/schedule/exceptions/${params.exceptionId}`,
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

// Atomic replace of a group's full member list. Use this from edit-group
// flows instead of looping add+remove client-side; the server diffs and
// applies in one transaction so a flaky network can't half-sync.
export const syncGroupMembers = async (params: {
  workspaceId: string
  groupId: string
  userIds: string[]
}) => {
  return await getApiClient().request<
    {
      groupId: string
      addedCount: number
      removedCount: number
      memberCount: number
    },
    { userIds: string[] }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/groups/${params.groupId}/members`,
    data: { userIds: params.userIds },
  })
}

export type Role = ApiTypes.ListRolesOutputOutput["data"][number]

export const listRoles = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{ data: Role[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/roles`,
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
