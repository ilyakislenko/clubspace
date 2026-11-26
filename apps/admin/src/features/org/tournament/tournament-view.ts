import { matchFinishLabel, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import { pluralRu } from "../../../shared/lib/plural-ru"
import { toCsv } from "../org-view"

// View helpers of the federation tournament console
// (docs/design/2026-11-27-tournaments.md §7). Pure: the pages pass in what
// the API returned. Weights travel as kg with one decimal.

export type TournamentStatus = "SETUP" | "WEIGH_IN" | "RUNNING" | "FINISHED"

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  SETUP: "Приём заявок",
  WEIGH_IN: "Взвешивание",
  RUNNING: "Идёт",
  FINISHED: "Итоги опубликованы",
}

// ---- weights ------------------------------------------------------------------

// «77,4» — always one decimal, the Russian comma.
export const formatKg = (kg: number): string =>
  kg.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// What the volunteer typed on the scale («77,4», «77.4», «77») → kg, or null
// when it is not a weight with at most one decimal. The range check is the
// caller's (contract limits).
export const parseKg = (raw: string): number | null => {
  const value = raw.trim().replace(",", ".")
  if (!/^\d{1,3}(\.\d)?$/.test(value)) return null
  return Number(value)
}

// «76,0 → 77,4 кг» once weighed, «76,0 кг» declared only; null after the
// retention cleared both.
export const weightLine = (declaredKg: number | null, weighedKg: number | null): string | null => {
  if (declaredKg != null && weighedKg != null) return `${formatKg(declaredKg)} → ${formatKg(weighedKg)} кг`
  if (weighedKg != null) return `${formatKg(weighedKg)} кг`
  if (declaredKg != null) return `${formatKg(declaredKg)} кг`
  return null
}

// ---- «Добавить категории» -----------------------------------------------------

export type WeightBand = { minKg: number | null; maxKg: number | null }

// «58 64 70 76 +76» → до 58, 58–64, 64–70, 70–76, св. 76. Empty → one open
// weight («абсолютная»). Bounds must grow; «+N» only last.
export const parseWeightBands = (raw: string): { bands: WeightBand[] } | { error: string } => {
  const tokens = raw
    .trim()
    .split(/[\s;]+/)
    .filter(Boolean)
  if (tokens.length === 0) return { bands: [{ minKg: null, maxKg: null }] }
  const bands: WeightBand[] = []
  let previous: number | null = null
  for (const [i, token] of tokens.entries()) {
    const open = token.startsWith("+")
    const kg = parseKg(open ? token.slice(1) : token)
    if (kg === null) return { error: `Не вес: «${token}»` }
    if (open) {
      if (i !== tokens.length - 1) return { error: "«+» ставится только у последнего веса" }
      bands.push({ minKg: kg, maxKg: null })
      continue
    }
    if (previous !== null && kg <= previous) return { error: "Веса идут по возрастанию" }
    bands.push({ minKg: previous, maxKg: kg })
    previous = kg
  }
  return { bands }
}

export type CompetitorSex = "FEMALE" | "MALE"

export const SEX_LABEL: Record<CompetitorSex, string> = { MALE: "Мужчины", FEMALE: "Женщины" }

export type DivisionCriteria = {
  sex: CompetitorSex | null
  ageMin: number | null
  ageMax: number | null
  levelLabel: string | null
} & WeightBand

export const ageLabel = (min: number | null, max: number | null): string | null => {
  if (min != null && max != null) return min === max ? `${min} лет` : `${min}–${max} лет`
  if (min != null) return `от ${min} лет`
  if (max != null) return `до ${max} лет`
  return null
}

export const weightBandLabel = ({ minKg, maxKg }: WeightBand): string => {
  const kg = (n: number) => (Number.isInteger(n) ? String(n) : formatKg(n))
  if (maxKg != null) return `до ${kg(maxKg)} кг`
  if (minKg != null) return `св. ${kg(minKg)} кг`
  return "абсолютная"
}

// «Мужчины · 18–35 лет · Синий – коричневый · до 76 кг»: the preview row of
// the generator, the same order the server names a division in.
export const divisionPreviewName = (c: DivisionCriteria): string =>
  [c.sex ? SEX_LABEL[c.sex] : null, ageLabel(c.ageMin, c.ageMax), c.levelLabel, weightBandLabel(c)]
    .filter(Boolean)
    .join(" · ")

// «Синий – коричневый»; one level reads once.
export const levelRangeLabel = (from: string | null, to: string | null): string | null => {
  if (from && to) return from === to ? from : `${from} – ${to}`
  return from ?? to ?? null
}

// The discipline's word for a rung: «Пояс» in grappling, «Уровень» elsewhere.
export const levelWord = (orgType: string | null | undefined): string =>
  (orgType ?? "").toUpperCase() === "GRAPPLING" ? "Пояс" : "Уровень"

// ---- divisions ----------------------------------------------------------------

// The muted state word of a division row.
export const DIVISION_STATE_LABEL: Record<"NOT_DRAWN" | "DRAWN" | "RUNNING" | "FINISHED", string> = {
  NOT_DRAWN: "нет сетки",
  DRAWN: "сетка",
  RUNNING: "идёт",
  FINISHED: "итоги",
}

export const entriesCount = (n: number): string => `${n} ${pluralRu(n, "участник", "участника", "участников")}`
export const divisionsCount = (n: number): string => `${n} ${pluralRu(n, "категория", "категории", "категорий")}`
export const matsCount = (n: number): string => `${n} ${pluralRu(n, "ковёр", "ковра", "ковров")}`

// ---- the tournament header --------------------------------------------------

export type TournamentSummary = {
  status: TournamentStatus
  resultsPublishedAt: string | null
  counts: {
    registrations: number
    declared: number
    confirmed: number
    weighed: number
    unweighed: number
    unassigned: number
    divisions: number
    divisionsDrawn: number
    divisionsFinished: number
  }
}

// One status line under the title: «Взвешивание · взвешено 46 из 52». The
// coach is named in the federation's words.
export const statusLine = (t: TournamentSummary, v: ClubVocabulary): string => {
  const c = t.counts
  switch (t.status) {
    case "SETUP":
      return [
        TOURNAMENT_STATUS_LABEL.SETUP,
        `подтверждено ${c.confirmed} из ${c.registrations}`,
        c.declared > 0 ? `ждут ${v.coach.gen} ${c.declared}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    case "WEIGH_IN":
      return `${TOURNAMENT_STATUS_LABEL.WEIGH_IN} · взвешено ${c.weighed} из ${c.weighed + c.unweighed}`
    case "RUNNING":
      return `${TOURNAMENT_STATUS_LABEL.RUNNING} · категорий с итогами ${c.divisionsFinished} из ${c.divisionsDrawn}`
    case "FINISHED":
      return t.resultsPublishedAt
        ? `${TOURNAMENT_STATUS_LABEL.FINISHED} ${publishedDate(t.resultsPublishedAt)}`
        : TOURNAMENT_STATUS_LABEL.FINISHED
  }
}

// «12 октября» — the day results went out (the admin's local day is fine:
// a header, not a protocol).
export const publishedDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })

export type TournamentAction = "WEIGH_IN" | "RUNNING" | "SETUP" | "publish" | "unpublish"

// Every drawn division has its places: the day can be published.
export const allFinished = (t: TournamentSummary): boolean =>
  t.counts.divisionsDrawn > 0 && t.counts.divisionsFinished === t.counts.divisionsDrawn

// The one filled button of the header, per status (design §7); none when
// nothing is due.
export const primaryAction = (
  t: TournamentSummary,
  isAdmin: boolean,
): { action: TournamentAction; label: string } | null => {
  if (t.status === "SETUP") return { action: "WEIGH_IN", label: "Начать взвешивание" }
  if (t.status === "WEIGH_IN") return { action: "RUNNING", label: "Начать турнир" }
  if (t.status === "RUNNING" && isAdmin && allFinished(t)) return { action: "publish", label: "Опубликовать итоги" }
  return null
}

// The rare step back, shown as a quiet button beside the primary (one item
// never hides in a «⋯»): reopen entries during weigh-in; admins unpublish.
export const secondaryAction = (
  t: TournamentSummary,
  isAdmin: boolean,
): { action: TournamentAction; label: string } | null => {
  if (t.status === "WEIGH_IN") return { action: "SETUP", label: "Вернуть приём заявок" }
  if (t.status === "FINISHED" && isAdmin) return { action: "unpublish", label: "Снять публикацию" }
  return null
}

// The «Начать турнир» confirm names who drops out first: every entry not on
// the scale — confirmed ones and those still waiting for their coach.
export const startConfirmText = (t: TournamentSummary): string => {
  const parts: string[] = []
  const dropped = t.counts.unweighed + t.counts.declared
  if (dropped > 0) {
    parts.push(`Не взвешены ${entriesCount(dropped)} — их снимут с турнира с отметкой «Не взвешен».`)
  }
  parts.push("Сетки соберутся во всех категориях, где есть взвешенные участники. Вернуться к взвешиванию будет нельзя.")
  return parts.join(" ")
}

// ---- competitors ----------------------------------------------------------------

export const HIDDEN_PERSON = "Участник скрыт"

export const competitorName = (c: { hidden: boolean; personName: string | null } | null): string =>
  !c ? "—" : c.hidden ? HIDDEN_PERSON : (c.personName ?? HIDDEN_PERSON)

// «в полуфинал», «в финал», «в 1/8 финала» — where a winner of `round` goes.
export const nextRoundPhrase = (round: number, totalRounds: number): string => {
  const fromEnd = totalRounds - (round + 1)
  if (fromEnd <= 0) return "в финал"
  if (fromEnd === 1) return "в полуфинал"
  if (fromEnd === 2) return "в четвертьфинал"
  return `в 1/${2 ** fromEnd} финала`
}

// What else an undo takes back: the winner's step forward, or the places
// after a final.
export const undoEffectText = (winnerName: string, round: number, totalRounds: number): string =>
  round >= totalRounds
    ? "Места в категории тоже снимутся."
    : `Выход ${nextRoundPhrase(round, totalRounds)} тоже отменится (${winnerName}).`

// ---- matches ------------------------------------------------------------------

export type MatchWinMethod = "FINISH" | "POINTS" | "DECISION" | "DISQUALIFICATION" | "WALKOVER"

export const MATCH_METHODS: readonly MatchWinMethod[] = ["FINISH", "POINTS", "DECISION", "DISQUALIFICATION", "WALKOVER"]

export const methodLabel = (method: MatchWinMethod, orgType: string | null | undefined): string => {
  switch (method) {
    case "FINISH":
      return matchFinishLabel(orgType)
    case "POINTS":
      return "По очкам"
    case "DECISION":
      return "Решение судей"
    case "DISQUALIFICATION":
      return "Дисквалификация"
    case "WALKOVER":
      return "Неявка"
  }
}

// Scores are asked only where they decide the match.
export const methodHasScore = (method: MatchWinMethod | null): boolean => method === "POINTS" || method === "DECISION"

// The finish method names its technique («Приём») instead.
export const methodHasNote = (method: MatchWinMethod | null): boolean => method === "FINISH"

// The short tail next to the winner on a bracket card: «болевой», «8:2»
// (the winner's score first), «неявка».
export const methodShort = (
  m: { method: MatchWinMethod | null; scoreA: number | null; scoreB: number | null; note: string | null },
  winnerSide: "A" | "B" | null,
  orgType: string | null | undefined,
): string | null => {
  switch (m.method) {
    case null:
      return null
    case "FINISH":
      return m.note?.trim() || ((orgType ?? "").toUpperCase() === "GRAPPLING" ? "болевой" : "досрочно")
    case "POINTS":
    case "DECISION": {
      if (m.scoreA == null || m.scoreB == null) return m.method === "POINTS" ? "по очкам" : "решение судей"
      return winnerSide === "B" ? `${m.scoreB}:${m.scoreA}` : `${m.scoreA}:${m.scoreB}`
    }
    case "DISQUALIFICATION":
      return "дисквалификация"
    case "WALKOVER":
      return "неявка"
  }
}

// ---- entries ------------------------------------------------------------------

export type EntryFilter = "all" | "unweighed" | "offWeight" | "unassigned" | "declared" | "withdrawn"

// The one Select filter of «Участники» (no chip rows).
export const entryFilters = (v: ClubVocabulary): readonly { id: EntryFilter; label: string }[] => [
  { id: "all", label: "Все" },
  { id: "unweighed", label: "Не взвешены" },
  { id: "offWeight", label: "Не в весе" },
  { id: "unassigned", label: "Без категории" },
  { id: "declared", label: `Ждут ${v.coach.gen}` },
  { id: "withdrawn", label: "Сняты" },
]

export const ENTRY_FILTER_IDS: readonly EntryFilter[] = ["all", "unweighed", "offWeight", "unassigned", "declared", "withdrawn"]

// ---- results ------------------------------------------------------------------

export const placeLabel = (place: number): string => `${place} место`

// «Скачать протокол (CSV)»: division, place, name, club — what goes to the
// sports committee. Unfinished divisions are left out.
export const resultsCsv = (
  divisions: readonly {
    name: string
    finished: boolean
    podium: readonly { place: number; personName: string; clubName: string | null }[]
  }[],
): string =>
  toCsv(
    ["Категория", "Место", "Участник", "Клуб"],
    divisions
      .filter((d) => d.finished)
      .flatMap((d) =>
        [...d.podium]
          .sort((a, b) => a.place - b.place)
          .map((p) => [d.name, String(p.place), p.personName, p.clubName ?? ""]),
      ),
  )
