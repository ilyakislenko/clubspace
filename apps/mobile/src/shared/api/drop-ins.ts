import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MyDropIns = ApiTypes.MyDropInsOutputOutput
export type DropInBooking = ApiTypes.DropInBookingOutputOutput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/drop-ins`

// The member's upcoming bookings into other groups' classes, plus whether they
// may book right now (and why not). `canBook` ignores freezes — the server
// refuses a frozen member's booking with its own message.
export const getMyDropIns = async (params: {
  workspaceId: string
}): Promise<MyDropIns> =>
  await getApiClient().request<MyDropIns>({
    method: "get",
    url: `${base(params.workspaceId)}/mine`,
  })

// Idempotent server-side: booking the same class twice returns the same row.
export const createDropIn = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
}): Promise<DropInBooking> =>
  await getApiClient().request<
    DropInBooking,
    { slotId: string; sessionDate: string }
  >({
    method: "post",
    url: base(params.workspaceId),
    data: { slotId: params.slotId, sessionDate: params.sessionDate },
  })

export const cancelDropIn = async (params: {
  workspaceId: string
  bookingId: string
}): Promise<{ status: "cancelled" }> =>
  await getApiClient().request<{ status: "cancelled" }>({
    method: "delete",
    url: `${base(params.workspaceId)}/${params.bookingId}`,
  })
