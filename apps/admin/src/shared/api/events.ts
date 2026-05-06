import { getApiClient } from "./client"

export type WorkspaceEvent = {
  id: string
  workspaceId: string
  title: string
  description: string | null
  link: string | null
  startAt: string
  endAt: string
  gym: { id: string; name: string; address: string } | null
  coach: {
    id: string
    email: string
    firstname: string | null
    lastname: string | null
  } | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export type EventInput = {
  title: string
  description?: string | null
  link?: string | null
  startAt: string
  endAt: string
  gymId?: string | null
  coachId?: string | null
}

export const listEvents = async (params: {
  workspaceId: string
  from?: string
  to?: string
}): Promise<{ data: WorkspaceEvent[] }> => {
  return await getApiClient().request<{ data: WorkspaceEvent[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/events`,
    params: { from: params.from, to: params.to },
  })
}

export const createEvent = async (params: {
  workspaceId: string
  data: EventInput
}): Promise<WorkspaceEvent> => {
  return await getApiClient().request<WorkspaceEvent, EventInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/events`,
    data: params.data,
  })
}

export const updateEvent = async (params: {
  workspaceId: string
  eventId: string
  data: Partial<EventInput>
}): Promise<WorkspaceEvent> => {
  return await getApiClient().request<WorkspaceEvent, Partial<EventInput>>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/events/${params.eventId}`,
    data: params.data,
  })
}

export const deleteEvent = async (params: {
  workspaceId: string
  eventId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/events/${params.eventId}`,
  })
}
