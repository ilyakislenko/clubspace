import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// The federations a club belongs to, as one member sees them
// (docs/design/2026-11-26-federation-hub-mvp.md §5). Every route is a club
// route, so a guardian acting for a child reads and decides for the child
// (X-Act-As). The server answers 404 while the platform has federations off
// (ORGANIZATIONS_ENABLED) — callers show nothing then.

export type MyClubOrganization =
  ApiTypes.ListMyClubOrganizationsOutputOutput["data"][number]
export type ClubOrgEvent = ApiTypes.ListClubOrgEventsOutputOutput["data"][number]
// A COMPETITION event's tournament and the viewer's entry line
// (docs/design/2026-11-27-tournaments.md §8).
export type ClubOrgEventEntryState = NonNullable<ClubOrgEvent["myEntryState"]>
export type MyTournamentPodium = MyClubOrganization["podiums"][number]
export type OrgEventRegistrationRef = ApiTypes.OrgEventRegistrationRefOutputOutput
export type OrgEventStudent =
  ApiTypes.ListOrgEventStudentsOutputOutput["data"][number]

// The club's ACTIVE federations with the viewer's consent standing, the
// consent text and whether their belt is in the federation's registry.
export const listMyClubOrganizations = async (params: {
  workspaceId: string
}): Promise<MyClubOrganization[]> =>
  (
    await getApiClient().request<ApiTypes.ListMyClubOrganizationsOutputOutput>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/me/organizations`,
    })
  ).data

// «Показывать мой пояс и записи федерации»: true consents (idempotent),
// false withdraws — the federation stops seeing the person at once.
export const setMyOrganizationConsent = async (params: {
  workspaceId: string
  organizationId: string
  granted: boolean
}): Promise<MyClubOrganization> =>
  await getApiClient().request<
    ApiTypes.SetMyOrganizationConsentOutputOutput,
    ApiTypes.SetMyOrganizationConsentInput
  >({
    method: "put",
    url: `/workspaces/${params.workspaceId}/me/organizations/${params.organizationId}/consent`,
    data: { granted: params.granted },
  })

// Upcoming federation events the club lets into the app.
export const listClubOrgEvents = async (params: {
  workspaceId: string
}): Promise<ClubOrgEvent[]> =>
  (
    await getApiClient().request<ApiTypes.ListClubOrgEventsOutputOutput>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/org-events`,
    })
  ).data

// Free registration through this club: oneself (the child when acting for
// it), or — `userId` — a coach for a consenting student of their groups.
// 409 ORG_CONSENT_REQUIRED when the athlete has not consented yet.
export const registerForOrgEvent = async (params: {
  workspaceId: string
  eventId: string
  userId?: string
}): Promise<OrgEventRegistrationRef> =>
  await getApiClient().request<
    OrgEventRegistrationRef,
    ApiTypes.RegisterForOrgEventInput
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/org-events/${params.eventId}/registrations`,
    data: params.userId ? { userId: params.userId } : {},
  })

// Self, the guardian, or the coach who booked it.
export const cancelOrgEventRegistration = async (params: {
  workspaceId: string
  registrationId: string
}): Promise<OrgEventRegistrationRef> =>
  await getApiClient().request<ApiTypes.CancelOrgEventRegistrationOutputOutput>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/org-event-registrations/${params.registrationId}`,
  })

// The coach's picker: students of their groups, who consented, who is booked.
export const listOrgEventStudents = async (params: {
  workspaceId: string
  eventId: string
}): Promise<OrgEventStudent[]> =>
  (
    await getApiClient().request<ApiTypes.ListOrgEventStudentsOutputOutput>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/org-events/${params.eventId}/students`,
    })
  ).data
