import type { Noun } from "@clubspace/ui-kit/brand"

import type { ClubOrgEvent, MyClubOrganization } from "../../shared/api/organizations"
import type {
  ClubTournament,
  ClubTournamentAthlete,
  ClubTournamentBracketMatch,
  ClubTournamentEntry,
  ClubTournamentNextMatch,
  ClubTournamentPerson,
} from "../../shared/api/tournaments"
import { formatRuDay, pluralRu } from "../../shared/format-ru"

// Federation tournaments in the member app (docs/design/2026-11-27-tournaments.md
// §8): the wording of the Events row, the tournament screen, the coach's list,
// the bracket and «Мои пояса». Pure, so the states are pinned by the spec.

// ---- weights ------------------------------------------------------------------

// 77.4 → «77,4», 76 → «76».
export const formatKg = (kg: number): string =>
  Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(".", ",")

// The server's weight rule (organizations/tournaments TOURNAMENT_LIMITS:
// 10.0–250.0 kg, step 0.1).
export const WEIGHT_KG = { min: 10, max: 250 } as const

// «77,4» / «77.4» / «77» → 77.4; null when it isn't a weight the server takes.
export const parseKgInput = (raw: string): number | null => {
  const text = raw.trim().replace(",", ".")
  if (!/^\d{1,3}(\.\d)?$/.test(text)) return null
  const kg = Number(text)
  return kg >= WEIGHT_KG.min && kg <= WEIGHT_KG.max ? kg : null
}

// Own data only (athlete, guardian, own coach): «Заявлено 77,4 кг · на весах
// 77,9 кг»; null once the retention cleared both.
export const entryWeightsLine = (
  e: Pick<ClubTournamentEntry, "declaredWeightKg" | "weighedWeightKg">,
): string | null =>
  [
    e.declaredWeightKg !== null ? `Заявлено ${formatKg(e.declaredWeightKg)} кг` : null,
    e.weighedWeightKg !== null ? `на весах ${formatKg(e.weighedWeightKg)} кг` : null,
  ]
    .filter(Boolean)
    .join(" · ") || null

// ---- people, places, queue ------------------------------------------------------

export const HIDDEN_PERSON = "Участник скрыт"

// «Пётр Сидоров (Беркут)»; «Участник скрыт» without the federation consent.
export const personLabel = (
  p: Pick<ClubTournamentPerson, "hidden" | "personName" | "clubName"> | null,
): string => {
  if (!p || p.hidden || !p.personName) return HIDDEN_PERSON
  return p.clubName ? `${p.personName} (${p.clubName})` : p.personName
}

// Just the name in a bracket cell (the club is a second line there).
export const personName = (
  p: Pick<ClubTournamentPerson, "hidden" | "personName"> | null,
): string => (!p || p.hidden || !p.personName ? HIDDEN_PERSON : p.personName)

export const placeLabel = (place: number): string => `${place} место`

// «перед вами 2 схватки» / «ваша схватка следующая» (as the server's push).
export const aheadLabel = (ahead: number): string =>
  ahead === 0
    ? "ваша схватка следующая"
    : `перед вами ${ahead} ${pluralRu(ahead, "схватка", "схватки", "схваток")}`

// The next match, as two lines: where («Ковёр 2 · перед вами 2 схватки»)
// and against whom («Соперник: Пётр Сидоров (Беркут)» / «Соперник —
// победитель схватки Петров — Сидоров»).
export const nextMatchLines = (
  next: ClubTournamentNextMatch,
): { where: string; opponent: string | null } => {
  const where =
    next.mat === null
      ? "Ковёр не назначен"
      : next.ahead === null
        ? `Ковёр ${next.mat}`
        : `Ковёр ${next.mat} · ${aheadLabel(next.ahead)}`
  if (next.opponent) return { where, opponent: `Соперник: ${personLabel(next.opponent)}` }
  if (next.waitingFor) {
    return {
      where,
      opponent: `Соперник — победитель схватки ${personName(next.waitingFor.entryA)} — ${personName(next.waitingFor.entryB)}`,
    }
  }
  return { where, opponent: null }
}

// ---- the Events row --------------------------------------------------------------

// The one truest line under a COMPETITION row with a tournament: a member
// reads their entry, a coach how many entries wait for them. null = nothing
// to say.
export const eventTournamentLine = (
  event: Pick<ClubOrgEvent, "tournament" | "myEntryState">,
  staff: boolean,
  // The club's word for a coach («тренера» / «педагога»).
  coach: Pick<Noun, "gen">,
): string | null => {
  const t = event.tournament
  if (!t) return null
  if (staff) {
    return t.toConfirmCount ? `Ждут подтверждения: ${t.toConfirmCount}` : null
  }
  const s = event.myEntryState
  if (!s) return null
  switch (s.state) {
    case "NEEDS_WEIGHT":
      return "Укажите вес для заявки"
    case "AWAITING_COACH":
      return `Заявка у ${coach.gen}`
    case "WITHDRAWN":
      return "Заявка снята"
    case "CONFIRMED":
      if (s.place !== null) return placeLabel(s.place)
      if (s.mat !== null && s.ahead !== null) return `Ковёр ${s.mat} · ${aheadLabel(s.ahead)}`
      return s.divisionName ?? "Категорию назначит федерация"
  }
}

// ---- the tournament screen ---------------------------------------------------------

// The header's one status line.
export const tournamentStatusLine = (t: Pick<ClubTournament, "status" | "matCount">): string => {
  switch (t.status) {
    case "SETUP":
      return "Приём заявок"
    case "WEIGH_IN":
      return "Взвешивание"
    case "RUNNING":
      return `Идёт · ${t.matCount} ${pluralRu(t.matCount, "ковёр", "ковра", "ковров")}`
    case "FINISHED":
      return "Итоги опубликованы"
  }
}

// One line about the athlete for the coach: «77,4 кг · Мужчина · 1997 г. р.».
export const athleteFactsLine = (
  e: Pick<ClubTournamentEntry, "declaredWeightKg" | "sex" | "birthYear">,
): string => {
  const kids = new Date().getFullYear() - e.birthYear < 18
  const sex = e.sex === "MALE" ? (kids ? "Мальчик" : "Мужчина") : kids ? "Девочка" : "Женщина"
  return [e.declaredWeightKg !== null ? `${formatKg(e.declaredWeightKg)} кг` : null, sex, `${e.birthYear} г. р.`]
    .filter(Boolean)
    .join(" · ")
}

// The entry's own line: the division, or where the entry stands.
export const entryStateLine = (
  e: Pick<ClubTournamentEntry, "status" | "divisionName" | "withdrawnReason">,
  coach: Pick<Noun, "gen">,
): string => {
  if (e.status === "DECLARED") return `Заявка у ${coach.gen}`
  if (e.status === "WITHDRAWN") return e.withdrawnReason ? `Заявка снята: ${e.withdrawnReason}` : "Заявка снята"
  return e.divisionName ?? "Категорию назначит федерация"
}

// Out of the bracket: drawn, running or over, no next match and no place.
export const isEliminated = (
  e: Pick<ClubTournamentEntry, "status" | "bracketAvailable" | "nextMatch" | "place">,
  status: ClubTournament["status"],
): boolean =>
  e.status === "CONFIRMED" &&
  e.bracketAvailable &&
  e.nextMatch === null &&
  e.place === null &&
  (status === "RUNNING" || status === "FINISHED")

export type TournamentSections = {
  // «Заявка: укажите вес» (no entry yet) or the entry row opens the sheet to
  // change the weight (SETUP only).
  declare: boolean
  entry: boolean
  nextMatch: boolean
  bracket: boolean
  place: boolean
  eliminated: boolean
  results: boolean
  // Staff: «Ждут подтверждения (N)» and «Мои спортсмены».
  toConfirm: boolean
  athletes: boolean
}

// Which sections the screen renders: only the true ones.
export const tournamentSections = (
  t: Pick<ClubTournament, "status" | "canDeclare" | "myEntry" | "toConfirmCount">,
  staff: boolean,
): TournamentSections => {
  const e = t.myEntry
  return {
    declare: !staff && t.canDeclare,
    entry: !staff && !!e,
    nextMatch: !staff && t.status === "RUNNING" && !!e?.nextMatch,
    bracket: !staff && !!e?.bracketAvailable && !!e.divisionId,
    place: !staff && e?.place !== null && e?.place !== undefined,
    eliminated: !staff && !!e && isEliminated(e, t.status),
    results: t.status === "FINISHED",
    toConfirm: staff && (t.toConfirmCount ?? 0) > 0,
    athletes: staff,
  }
}

// Poll while the screen is focused and the tournament runs.
export const TOURNAMENT_POLL_MS = 30_000

// ---- the coach's list ----------------------------------------------------------------

export type AthleteRowKind =
  // No booking for the event through the club: booked from «События».
  | "notBooked"
  // Booked, no weight yet: the coach declares (auto-confirmed).
  | "needsWeight"
  // Declared by the athlete / guardian: the coach confirms.
  | "toConfirm"
  | "confirmed"
  | "withdrawn"

export const athleteRowKind = (a: Pick<ClubTournamentAthlete, "registrationId" | "entry">): AthleteRowKind => {
  if (a.entry?.status === "DECLARED") return "toConfirm"
  if (a.entry?.status === "WITHDRAWN") return "withdrawn"
  if (a.entry) return "confirmed"
  return a.registrationId ? "needsWeight" : "notBooked"
}

// Second line of a student row: the category or what is missing.
export const athleteCategoryLine = (
  a: Pick<ClubTournamentAthlete, "registrationId" | "entry">,
  coach: Pick<Noun, "gen">,
): string => {
  if (a.entry) return a.entry.status === "DECLARED" ? "ждёт подтверждения" : entryStateLine(a.entry, coach)
  return a.registrationId ? "нет веса" : "не записан"
}

// The trailing state of a confirmed student: «ковёр 2, через 1» / «1 место» /
// «выбыл(а)» by the entry's sex; null when nothing is happening yet.
export const athleteStatusLabel = (
  a: Pick<ClubTournamentAthlete, "entry">,
  status: ClubTournament["status"],
): string | null => {
  const e = a.entry
  if (!e || e.status !== "CONFIRMED") return null
  if (e.place !== null) return placeLabel(e.place)
  if (e.nextMatch?.mat != null) {
    return e.nextMatch.ahead === null
      ? `ковёр ${e.nextMatch.mat}`
      : e.nextMatch.ahead === 0
        ? `ковёр ${e.nextMatch.mat}, следующий`
        : `ковёр ${e.nextMatch.mat}, через ${e.nextMatch.ahead}`
  }
  if (!isEliminated(e, status)) return null
  return e.sex === "FEMALE" ? "выбыла" : "выбыл"
}

// Entries waiting for this coach, first.
export const sortAthletes = <T extends Pick<ClubTournamentAthlete, "registrationId" | "entry" | "name">>(list: readonly T[]): T[] => {
  const rank: Record<AthleteRowKind, number> = { toConfirm: 0, confirmed: 1, needsWeight: 2, withdrawn: 3, notBooked: 4 }
  return [...list].sort((a, b) => rank[athleteRowKind(a)] - rank[athleteRowKind(b)] || a.name.localeCompare(b.name, "ru"))
}

// ---- the bracket ----------------------------------------------------------------

// The short result on a bracket card: «8:2», «решение 2:2», «досрочно»,
// «неявка»; null while undecided or for a bye.
export const matchResultShort = (
  m: Pick<ClubTournamentBracketMatch, "isBye" | "method" | "scoreA" | "scoreB">,
): string | null => {
  if (m.isBye || !m.method) return null
  const score = m.scoreA !== null && m.scoreB !== null ? `${m.scoreA}:${m.scoreB}` : null
  switch (m.method) {
    case "POINTS":
      return score ?? "по очкам"
    case "DECISION":
      return score ? `решение ${score}` : "решение судей"
    case "FINISH":
      return "досрочно"
    case "DISQUALIFICATION":
      return "дисквалификация"
    case "WALKOVER":
      return "неявка"
  }
}

// Columns from the end: «Финал», «1/2», «1/4», «1/8»…
export const roundLabel = (round: number, rounds: number): string => {
  const fromEnd = rounds - round
  return fromEnd === 0 ? "Финал" : `1/${2 ** fromEnd}`
}

// The round the viewer's athlete is in (the latest with them), else the first.
export const initialRound = (
  matches: readonly { round: number; entryA: { isMe: boolean } | null; entryB: { isMe: boolean } | null }[],
): number =>
  matches
    .filter((m) => m.entryA?.isMe || m.entryB?.isMe)
    .reduce((r, m) => Math.max(r, m.round), 1)

// An empty slot names the match that fills it, as the next-match line does:
// bracket.ts sends the winner of (round, position) to (round + 1,
// ⌈position / 2⌉), odd positions to side A. «—» while that match itself
// still waits for someone.
export const pendingSlotLabel = (
  matches: readonly Pick<ClubTournamentBracketMatch, "round" | "position" | "entryA" | "entryB">[],
  match: Pick<ClubTournamentBracketMatch, "round" | "position">,
  side: "A" | "B",
): string => {
  const position = 2 * match.position - (side === "A" ? 1 : 0)
  const feeder = matches.find((m) => m.round === match.round - 1 && m.position === position)
  if (!feeder?.entryA || !feeder.entryB) return "—"
  return `победитель схватки ${personName(feeder.entryA)} — ${personName(feeder.entryB)}`
}

// ---- «Мои пояса» --------------------------------------------------------------------

// «2 место — Кубок федерации, 1-й этап · 12 октября», newest first. `linked`:
// the line opens the results, which the club shows its members only while it
// allows the federation's events (`eventsEnabled`); otherwise plain text.
export const podiumLines = (
  orgs: readonly Pick<MyClubOrganization, "podiums" | "eventsEnabled">[],
): { eventId: string; line: string; linked: boolean }[] =>
  orgs
    .flatMap((o) => o.podiums.map((p) => ({ p, linked: o.eventsEnabled })))
    .sort((a, b) => b.p.date.localeCompare(a.p.date))
    .map(({ p, linked }) => ({
      eventId: p.eventId,
      line: `${placeLabel(p.place)} — ${p.tournamentTitle} · ${formatRuDay(p.date)}`,
      linked,
    }))
