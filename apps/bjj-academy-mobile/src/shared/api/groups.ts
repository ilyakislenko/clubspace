import { getApiClient } from "./client"

export type MyGroup = {
  id: string
  name: string
  role: "coach" | "student"
  scheduleText: string | null
  gym: { id: string; name: string; address: string } | null
  coach: {
    id: string
    firstname: string | null
    lastname: string | null
    email: string
  }
  memberCount: number
}

// Returns the groups the current user belongs to in the given workspace,
// tagged by role: 'coach' for groups they lead, 'student' for groups they
// trained in. Empty array means the user is in no groups yet.
export const getMyGroups = async (params: {
  workspaceId: string
}): Promise<MyGroup[]> => {
  const response = await getApiClient().request<{ data: MyGroup[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/groups`,
  })
  return response.data ?? []
}

export type GymCard = {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  groupCount: number
}

// Returns every gym in the workspace. Used by the mobile "Залы"
// screen — students need to know where their classes happen.
export const listGyms = async (params: {
  workspaceId: string
}): Promise<GymCard[]> => {
  const response = await getApiClient().request<{ data: GymCard[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/gyms`,
  })
  return response.data ?? []
}
