import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClassBooking = ApiTypes.ClassBookingOutputOutput
export type ClassBookingStatus = ClassBooking["status"]
export type MyClassBookings = ApiTypes.MyClassBookingsOutputOutput
export type ClassOccurrence = ApiTypes.ClassOccurrenceOutputOutput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/class-bookings`

// A place in a booking-mode class, or a waitlist place when it is full.
// Idempotent server-side: re-sending returns the held booking.
export const bookClass = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
}): Promise<ClassBooking> =>
  await getApiClient().request<ClassBooking, ApiTypes.BookClassInput>({
    method: "post",
    url: base(params.workspaceId),
    data: { slotId: params.slotId, sessionDate: params.sessionDate },
  })

// Cancel a place or leave the waitlist; also declines a waitlist promotion.
export const cancelClassBooking = async (params: {
  workspaceId: string
  bookingId: string
}): Promise<ClassBooking> =>
  await getApiClient().request<ClassBooking>({
    method: "delete",
    url: `${base(params.workspaceId)}/${params.bookingId}`,
  })

// Upcoming bookings plus recent history (late cancels, no-shows, burns).
export const getMyClassBookings = async (params: {
  workspaceId: string
}): Promise<MyClassBookings> =>
  await getApiClient().request<MyClassBookings>({
    method: "get",
    url: `${base(params.workspaceId)}/mine`,
  })

const occurrenceUrl = (p: {
  workspaceId: string
  slotId: string
  sessionDate: string
}) => `/workspaces/${p.workspaceId}/class-occurrences/${p.slotId}/${p.sessionDate}`

// Staff: one class's bookings, waitlist and cancels.
export const getClassOccurrence = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
}): Promise<ClassOccurrence> =>
  await getApiClient().request<ClassOccurrence>({
    method: "get",
    url: occurrenceUrl(params),
  })

// Staff: book a member into the class, over the capacity when it is full.
export const addClassBooking = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
  userId: string
}): Promise<ClassOccurrence> =>
  await getApiClient().request<ClassOccurrence, ApiTypes.AddClassBookingInput>({
    method: "post",
    url: `${occurrenceUrl(params)}/bookings`,
    data: { userId: params.userId },
  })
