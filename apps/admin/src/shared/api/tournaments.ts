import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Federation tournaments, org console (docs/design/2026-11-27-tournaments.md
// §5.1): `orgs/:organizationId/tournaments/*`, org staff; publishing and the
// mats count are the org admin's. Every read is ttl 0 — the pages poll them
// while RUNNING.

export type OrgTournament = ApiTypes.GetOrgTournamentOutputOutput
export type TournamentStatus = OrgTournament["status"]
export type TournamentDivision = ApiTypes.TournamentDivisionListOutputOutput["data"][number]
export type TournamentEntriesPage = ApiTypes.ListTournamentEntriesOutputOutput
export type TournamentEntry = TournamentEntriesPage["data"][number]
export type TournamentBracket = ApiTypes.TournamentBracketOutputOutput
export type TournamentMatch = TournamentBracket["matches"][number]
export type TournamentCompetitor = TournamentBracket["entries"][number]
export type TournamentMatQueue = ApiTypes.TournamentMatQueueOutputOutput
export type TournamentQueueMatch = TournamentMatQueue["next"][number]
export type TournamentResults = ApiTypes.TournamentResultsOutputOutput
export type WeighInResult = ApiTypes.RecordTournamentWeighInOutputOutput
export type DivisionCreateRow = ApiTypes.CreateTournamentDivisionsInput["rows"][number]
export type DivisionUpdateInput = ApiTypes.UpdateTournamentDivisionInput
export type MatchResultInput = ApiTypes.RecordTournamentMatchResultInput
export type EntryFilterParam = NonNullable<NonNullable<ApiTypes.ListTournamentEntriesData["query"]>["filter"]>

const base = (organizationId: string) => `/orgs/${organizationId}`
const tour = (organizationId: string, tournamentId: string) => `${base(organizationId)}/tournaments/${tournamentId}`

type T = { organizationId: string; tournamentId: string }

// ---- the tournament ----

export const createOrgTournament = (p: { organizationId: string; eventId: string; matCount?: number }) =>
  getApiClient().request<OrgTournament, { matCount?: number }>({
    method: "post",
    url: `${base(p.organizationId)}/events/${p.eventId}/tournament`,
    data: p.matCount ? { matCount: p.matCount } : {},
  })

export const getOrgTournament = (p: T) =>
  getApiClient().request<OrgTournament>({ method: "get", url: tour(p.organizationId, p.tournamentId) })

export const updateOrgTournament = (p: T & { matCount: number; expectedUpdatedAt: string }) =>
  getApiClient().request<OrgTournament, { matCount: number; expectedUpdatedAt: string }>({
    method: "patch",
    url: tour(p.organizationId, p.tournamentId),
    data: { matCount: p.matCount, expectedUpdatedAt: p.expectedUpdatedAt },
  })

export const setOrgTournamentStatus = (p: T & { status: "SETUP" | "WEIGH_IN" | "RUNNING" }) =>
  getApiClient().request<OrgTournament, { status: "SETUP" | "WEIGH_IN" | "RUNNING" }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/status`,
    data: { status: p.status },
  })

export const publishOrgTournamentResults = (p: T & { published: boolean }) =>
  getApiClient().request<OrgTournament, { published: boolean }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/publication`,
    data: { published: p.published },
  })

// ---- divisions ----

export const listTournamentDivisions = (p: T) =>
  getApiClient().request<{ data: TournamentDivision[] }>({
    method: "get",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions`,
  })

export const createTournamentDivisions = (p: T & { rows: DivisionCreateRow[] }) =>
  getApiClient().request<{ data: TournamentDivision[] }, { rows: DivisionCreateRow[] }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions`,
    data: { rows: p.rows },
  })

export const copyTournamentDivisions = (p: T & { fromTournamentId: string }) =>
  getApiClient().request<{ data: TournamentDivision[] }, { fromTournamentId: string }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions/copy`,
    data: { fromTournamentId: p.fromTournamentId },
  })

export const updateTournamentDivision = (p: T & { divisionId: string; data: DivisionUpdateInput }) =>
  getApiClient().request<TournamentDivision, DivisionUpdateInput>({
    method: "patch",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions/${p.divisionId}`,
    data: p.data,
  })

export const deleteTournamentDivision = (p: T & { divisionId: string }) =>
  getApiClient().request<unknown, undefined>({
    method: "delete",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions/${p.divisionId}`,
  })

export const assignTournamentMats = (p: T) =>
  getApiClient().request<{ data: TournamentDivision[] }, undefined>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/mats/assign`,
  })

export const drawTournamentDivision = (p: T & { divisionId: string }) =>
  getApiClient().request<TournamentBracket, undefined>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions/${p.divisionId}/draw`,
  })

export const getTournamentBracket = (p: T & { divisionId: string }) =>
  getApiClient().request<TournamentBracket>({
    method: "get",
    url: `${tour(p.organizationId, p.tournamentId)}/divisions/${p.divisionId}/bracket`,
  })

// ---- entries / weigh-in ----

export const listTournamentEntries = (
  p: T & { q?: string; divisionId?: string; filter?: EntryFilterParam; curPage?: number; perPage?: number },
) =>
  getApiClient().request<TournamentEntriesPage>({
    method: "get",
    url: `${tour(p.organizationId, p.tournamentId)}/entries`,
    params: { q: p.q || undefined, divisionId: p.divisionId, filter: p.filter, curPage: p.curPage, perPage: p.perPage },
  })

export const recordTournamentWeighIn = (p: T & { entryId: string; weighedKg: number }) =>
  getApiClient().request<WeighInResult, { weighedKg: number }>({
    method: "put",
    url: `${tour(p.organizationId, p.tournamentId)}/entries/${p.entryId}/weigh-in`,
    data: { weighedKg: p.weighedKg },
  })

export const moveTournamentEntry = (p: T & { entryId: string; divisionId: string }) =>
  getApiClient().request<TournamentEntry, { divisionId: string }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/entries/${p.entryId}/move`,
    data: { divisionId: p.divisionId },
  })

export const setTournamentEntryWithdrawn = (p: T & { entryId: string; withdrawn: boolean; reason?: string }) =>
  getApiClient().request<TournamentEntry, { withdrawn: boolean; reason?: string }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/entries/${p.entryId}/withdrawal`,
    data: { withdrawn: p.withdrawn, reason: p.reason },
  })

// ---- the day ----

export const getTournamentMatQueue = (p: T & { mat: number }) =>
  getApiClient().request<TournamentMatQueue>({
    method: "get",
    url: `${tour(p.organizationId, p.tournamentId)}/mats/${p.mat}/queue`,
  })

export const recordTournamentMatchResult = (p: T & { matchId: string; data: MatchResultInput }) =>
  getApiClient().request<TournamentBracket, MatchResultInput>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/matches/${p.matchId}/result`,
    data: p.data,
  })

export const undoTournamentMatchResult = (p: T & { matchId: string; expectedUpdatedAt: string }) =>
  getApiClient().request<TournamentBracket, { expectedUpdatedAt: string }>({
    method: "post",
    url: `${tour(p.organizationId, p.tournamentId)}/matches/${p.matchId}/undo`,
    data: { expectedUpdatedAt: p.expectedUpdatedAt },
  })

export const getTournamentResults = (p: T) =>
  getApiClient().request<TournamentResults>({
    method: "get",
    url: `${tour(p.organizationId, p.tournamentId)}/results`,
  })
