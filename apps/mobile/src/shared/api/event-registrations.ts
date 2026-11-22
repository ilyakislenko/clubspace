import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type EventRegistration = ApiTypes.EventRegistrationOutputOutput
export type EventTicketCheckout = ApiTypes.EventTicketCheckoutOutputOutput
export type PayEventRegistrationOnlineInput =
  ApiTypes.PayEventRegistrationOnlineInput

// A place in an event with a price or a limit (a master class), or a waitlist
// place when it is full. Idempotent server-side: re-sending returns the held
// registration. A guardian acting for a child registers the child (X-Act-As).
export const registerForEvent = async (params: {
  workspaceId: string
  eventId: string
}): Promise<EventRegistration> =>
  await getApiClient().request<EventRegistration>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/events/${params.eventId}/registrations`,
  })

// Give up a place or leave the waitlist; a freed place goes to the waitlist.
export const cancelEventRegistration = async (params: {
  workspaceId: string
  registrationId: string
}): Promise<EventRegistration> =>
  await getApiClient().request<EventRegistration>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/event-registrations/${params.registrationId}`,
  })

// Pay one's own held place online through the club's provider (a guardian the
// child's, via X-Act-As): the app opens `confirmationUrl`; the webhook marks
// the ticket paid. A repeated tap within a while returns the same payment.
// The server prices the ticket (the event's price, the family discount, the
// promo code) as `getCheckoutQuote` quoted it, or refuses the code with the
// reason. Never queued offline.
export const payEventRegistrationOnline = async (params: {
  workspaceId: string
  registrationId: string
  data: PayEventRegistrationOnlineInput
}): Promise<EventTicketCheckout> =>
  await getApiClient().request<
    EventTicketCheckout,
    PayEventRegistrationOnlineInput
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/event-registrations/${params.registrationId}/checkout`,
    data: params.data,
  })
