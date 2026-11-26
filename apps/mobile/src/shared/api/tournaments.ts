import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Federation tournaments in the member app
// (docs/design/2026-11-27-tournaments.md §8). Club routes: a guardian acting
// for a child reads and declares for the child (X-Act-As). Other people in a
// bracket or the results come without weights, birth years or ids.

export type ClubTournament = ApiTypes.GetClubTournamentOutputOutput
export type ClubTournamentEntry = ApiTypes.DeclareTournamentEntryOutputOutput
export type ClubTournamentNextMatch = NonNullable<ClubTournamentEntry["nextMatch"]>
export type ClubTournamentPerson = NonNullable<ClubTournamentNextMatch["opponent"]>
export type ClubTournamentLevel = ClubTournament["levels"][number]
export type ClubTournamentAthletes = ApiTypes.ListClubTournamentAthletesOutputOutput
export type ClubTournamentAthlete = ClubTournamentAthletes["data"][number]
export type ClubTournamentBracket = ApiTypes.GetClubTournamentBracketOutputOutput
export type ClubTournamentBracketMatch = ClubTournamentBracket["matches"][number]
export type ClubTournamentResults = ApiTypes.GetClubTournamentResultsOutputOutput
export type CompetitorSex = ClubTournamentEntry["sex"]

const base = (workspaceId: string, eventId: string) =>
  `/workspaces/${workspaceId}/org-events/${eventId}/tournament`

// The tournament of a federation event as this person (or the child) sees it.
export const getClubTournament = async (params: {
  workspaceId: string
  eventId: string
}): Promise<ClubTournament> =>
  await getApiClient().request<ClubTournament>({
    method: "get",
    url: base(params.workspaceId, params.eventId),
  })

// The entry's weight, sex and birth year: oneself (the child when acting
// for it) → waits for the coach; a coach for a student (`userId`) →
// confirmed at once. 409 ORG_CONSENT_REQUIRED on an older consent edition,
// 409 TOURNAMENT_LOCKED after the weigh-in started.
export const declareTournamentEntry = async (params: {
  workspaceId: string
  eventId: string
  body: ApiTypes.DeclareTournamentEntryInput
}): Promise<ClubTournamentEntry> =>
  await getApiClient().request<ClubTournamentEntry, ApiTypes.DeclareTournamentEntryInput>({
    method: "put",
    url: `${base(params.workspaceId, params.eventId)}/entry`,
    data: params.body,
  })

// The coach confirms a student's declaration; `templateLevelId` only when
// the registry has no belt for the student.
export const confirmTournamentEntry = async (params: {
  workspaceId: string
  entryId: string
  templateLevelId?: string
}): Promise<ClubTournamentEntry> =>
  await getApiClient().request<ClubTournamentEntry, ApiTypes.ConfirmTournamentEntryInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/tournament-entries/${params.entryId}/confirm`,
    data: params.templateLevelId ? { templateLevelId: params.templateLevelId } : {},
  })

// Staff: their students with the booking / entry state.
export const listClubTournamentAthletes = async (params: {
  workspaceId: string
  eventId: string
}): Promise<ClubTournamentAthletes> =>
  await getApiClient().request<ClubTournamentAthletes>({
    method: "get",
    url: `${base(params.workspaceId, params.eventId)}/athletes`,
  })

export const getClubTournamentBracket = async (params: {
  workspaceId: string
  eventId: string
  divisionId: string
}): Promise<ClubTournamentBracket> =>
  await getApiClient().request<ClubTournamentBracket>({
    method: "get",
    url: `${base(params.workspaceId, params.eventId)}/divisions/${params.divisionId}/bracket`,
  })

export const getClubTournamentResults = async (params: {
  workspaceId: string
  eventId: string
}): Promise<ClubTournamentResults> =>
  await getApiClient().request<ClubTournamentResults>({
    method: "get",
    url: `${base(params.workspaceId, params.eventId)}/results`,
  })
