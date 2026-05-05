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

export type GroupSummary = {
  id: string
  name: string
  scheduleText: string | null
  gym: { id: string; name: string; address: string }
  coach: GroupCoach
  memberCount: number
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
