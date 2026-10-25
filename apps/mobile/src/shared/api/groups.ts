import { getApiClient } from "./client"

export type GroupScheduleSlot = {
  id: string
  dayOfWeek: number
  startTime: string
  durationMin: number
  effectiveFrom: string | null
  effectiveUntil: string | null
}

export type GroupScheduleException = {
  id: string
  slotId: string | null
  fromDate: string
  untilDate: string
  reason: string | null
}

export type GroupCoachAssignment = {
  userId: string
  email: string | null
  firstname: string | null
  lastname: string | null
  role: "primary" | "assistant"
}

export type MyGroup = {
  id: string
  name: string
  role: "coach" | "student"
  // Zone the slots' wall-clock times are held in (gym, else workspace).
  // Optional: groups cached before the server sent it have none.
  timezone?: string
  gym: { id: string; name: string; address: string } | null
  coach: {
    id: string
    firstname: string | null
    lastname: string | null
    // null once the coach has left the club.
    email: string | null
    phone: string | null
  }
  // Full coach roster including the primary. Mobile renders a list when
  // there's more than one — solo-coach groups still look like before.
  coaches: GroupCoachAssignment[]
  memberCount: number
  slots: GroupScheduleSlot[]
  exceptions: GroupScheduleException[]
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

// Workspace-wide schedule projection — used by the "Расписание клуба"
// screen so a student can browse what other groups train when. The
// server expands recurring slots over the requested date range and
// applies any active cancellations, returning ready-to-render sessions.
export type ScheduleSession = {
  occurrenceId: string
  slotId: string
  groupId: string
  group: {
    id: string
    name: string
    gym: { id: string; name: string; address: string } | null
    coach: {
      id: string
      email: string
      firstname: string | null
      lastname: string | null
    }
  }
  // IANA timezone the wall-clock of this occurrence is in. Equals
  // gym.timezone when set on the gym, else workspace.timezone — the
  // schedule screen renders the hour/minute in this zone so a Tomsk
  // user reading a Krasnoyarsk gym still sees gym-local time.
  timezone: string
  startAt: string
  endAt: string
  durationMin: number
  dayOfWeek: number
  cancelled: boolean
  cancellationReason: string | null
  // Members of other groups who booked this class. Optional: cached payloads
  // predate it.
  bookedGuests?: number
}

export type ScheduleEvent = {
  id: string
  workspaceId: string
  title: string
  description: string | null
  link: string | null
  startAt: string
  endAt: string
  // IANA timezone the organiser tagged the event with — render the
  // wall-clock in this zone so a Tomsk seminar reads "14:00" everywhere
  // even if the workspace defaults to a different city.
  timezone: string
  gym: { id: string; name: string; address: string } | null
  coach: {
    id: string
    email: string
    firstname: string | null
    lastname: string | null
  } | null
  createdById: string
}

export type WorkspaceSchedule = {
  timezone: string
  sessions: ScheduleSession[]
  events: ScheduleEvent[]
}

export const getWorkspaceSchedule = async (params: {
  workspaceId: string
  from: string
  to: string
}): Promise<WorkspaceSchedule> => {
  return await getApiClient().request<WorkspaceSchedule>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/schedule`,
    params: { from: params.from, to: params.to },
  })
}

export const listEvents = async (params: {
  workspaceId: string
  from?: string
  to?: string
}): Promise<{ data: ScheduleEvent[] }> => {
  return await getApiClient().request<{ data: ScheduleEvent[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/events`,
    params: { from: params.from, to: params.to },
  })
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
