import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Staff roster of one dated class of a booking-mode group.
export type ClassOccurrence = ApiTypes.ClassOccurrenceOutputOutput
export type ClassOccurrenceBooking = ClassOccurrence["bookings"][number]
export type ClassBookingStatus = ClassOccurrenceBooking["status"]

const base = (p: { workspaceId: string; slotId: string; sessionDate: string }) =>
  `/workspaces/${p.workspaceId}/class-occurrences/${p.slotId}/${p.sessionDate}`

export const getClassOccurrence = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
}): Promise<ClassOccurrence> =>
  await getApiClient().request<ClassOccurrence>({
    method: "get",
    url: base(params),
  })

// Adds the member even when the class is full (overCapacity).
export const addClassBooking = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
  userId: string
}): Promise<ClassOccurrence> =>
  await getApiClient().request<ClassOccurrence, ApiTypes.AddClassBookingInput>({
    method: "post",
    url: `${base(params)}/bookings`,
    data: { userId: params.userId },
  })

export const removeClassBooking = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
  bookingId: string
}): Promise<ClassOccurrence> =>
  await getApiClient().request<ClassOccurrence, undefined>({
    method: "delete",
    url: `${base(params)}/bookings/${params.bookingId}`,
  })

// capacity null = back to the slot's / group's places.
export const setClassCapacity = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
  capacity: number | null
}): Promise<ClassOccurrence> =>
  await getApiClient().request<ClassOccurrence, ApiTypes.SetClassCapacityInput>({
    method: "put",
    url: `${base(params)}/capacity`,
    data: { capacity: params.capacity },
  })
