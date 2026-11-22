// Pure wording of the requests inbox («Ученики → Заявки») and its «Сегодня»
// row: kind names, the one detail line per row, waiting time, the per-kind
// breakdown and the URL state (`?kind=`, `?request=`).

import { cap, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import type {
  OpenRequest,
  RequestCounts,
  RequestKind,
} from "../../shared/api/requests"
import { GUARDIAN_LINE_PREFIX, guardianName } from "../../shared/lib/guardians"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatRoleName } from "../../shared/lib/role-labels"

// The server's order of kinds; the filter and the breakdown follow it.
export const REQUEST_KINDS: readonly RequestKind[] = ["join", "freeze", "personal", "video"]

// The muted first line of a row and the panel heading.
export const kindLabel = (kind: RequestKind, vocabulary: ClubVocabulary): string =>
  ({
    join: "Вступление",
    freeze: "Заморозка",
    personal: cap(vocabulary.personalSession.nom),
    video: "Разбор видео",
  })[kind]

// An option of the «Вид» filter.
export const kindFilterLabel = (kind: RequestKind, vocabulary: ClubVocabulary): string =>
  ({
    join: "Вступление",
    freeze: "Заморозка",
    personal: cap(vocabulary.personalSession.nomPl),
    video: "Разборы видео",
  })[kind]

// «… на вступление»: the breakdown names each kind as what was asked for, so
// the count agrees with the implied «заявки» in every club's words.
const askedFor = (kind: RequestKind, vocabulary: ClubVocabulary): string =>
  ({
    join: "на вступление",
    freeze: "на заморозку",
    personal: `на ${vocabulary.personalSession.acc}`,
    video: "на разбор видео",
  })[kind]

const shortDayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" })
const shortDayYearFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
})
const ymdShortFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

// «18 нояб.» of a calendar day ("YYYY-MM-DD"), never shifted by the browser zone.
export const formatShortYmd = (ymd: string): string => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number)
  return ymdShortFmt.format(new Date(Date.UTC(y, m - 1, d)))
}

// «3 нояб.», with the year only when it is not this year's.
export const formatShortDate = (iso: string, now: Date): string => {
  const date = new Date(iso)
  return (date.getFullYear() === now.getFullYear() ? shortDayFmt : shortDayYearFmt).format(date)
}

// How long the request has waited: «только что», «25 мин», «2 ч», «3 дня»;
// a week or more reads as the day it came in.
export const waitingLabel = (createdAt: string, now: Date): string => {
  const min = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ч`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ${pluralRu(days, "день", "дня", "дней")}`
  return formatShortDate(createdAt, now)
}

// «15 ноября, 14:05» — when the request came in (panel facts), with the year
// only when it is not this year's.
export const formatSentAt = (iso: string, now: Date): string => {
  const date = new Date(iso)
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  })
}

// «пт, 21 нояб., 13:00» in the request's own time zone.
export const formatSlot = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso))

type PersonalDetail = NonNullable<OpenRequest["personal"]>
type PersonalOption = PersonalDetail["options"][number]

// A time the member offered: «пт, 21 нояб., 13:00 · 60 мин».
export const optionLabel = (option: PersonalOption, timeZone: string): string =>
  `${formatSlot(option.startAt, timeZone)} · ${option.durationMin} мин`

// «Ребёнок», «Родитель: Анна Петрова» — the roster's wording.
export const guardiansLine = (member: OpenRequest["member"]): string | null =>
  member.guardians.length > 0
    ? member.guardians
        .map((g) => `${GUARDIAN_LINE_PREFIX[g.relation]}: ${guardianName(g) || g.email || "—"}`)
        .join(" · ")
    : null

// The staff role a pending row would get; null for a student.
export const joinRole = (request: OpenRequest, vocabulary: ClubVocabulary): string | null =>
  request.join && request.join.roleName !== "user"
    ? formatRoleName(request.join.roleName, vocabulary)
    : null

// The row's detail line, one per kind. `viewerId` hides the coach's name on
// the coach's own personal requests.
export const detailLine = (
  request: OpenRequest,
  vocabulary: ClubVocabulary,
  viewerId: string | null,
): string => {
  switch (request.kind) {
    case "join": {
      const role = joinRole(request, vocabulary)
      return [
        // A child shows the roster's «Ребёнок» badge by the name instead.
        request.member.isDependent ? null : request.member.email,
        role && `роль: ${role}`,
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "freeze": {
      const f = request.freeze
      if (!f) return ""
      return [
        `${f.days} ${pluralRu(f.days, "день", "дня", "дней")} с ${formatShortYmd(f.fromDate)}`,
        f.planName,
        f.reason,
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "personal": {
      const p = request.personal
      if (!p) return ""
      const [first, ...rest] = p.options
      return [
        first ? formatSlot(first.startAt, p.timezone) : null,
        rest.length > 0 &&
          `ещё ${rest.length} ${pluralRu(rest.length, "вариант", "варианта", "вариантов")}`,
        // Shown once the viewer is known, so a coach never reads their own name.
        viewerId !== null && p.coach.userId !== viewerId && p.coach.name,
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "video": {
      const v = request.video
      if (!v) return ""
      return v.clipStatus === "processing" ? `«${v.title}» · видео обрабатывается` : `«${v.title}»`
    }
  }
}

// The kinds that have something waiting, in the server's order.
export const waitingKinds = (counts: RequestCounts): RequestKind[] =>
  REQUEST_KINDS.filter((kind) => counts[kind] > 0)

// The «Сегодня» hint: «2 на вступление · 1 на заморозку · …», non-zero kinds.
export const requestsBreakdown = (counts: RequestCounts, vocabulary: ClubVocabulary): string =>
  waitingKinds(counts)
    .map((kind) => `${counts[kind]} ${askedFor(kind, vocabulary)}`)
    .join(" · ")

// Where the «Сегодня» row leads: the list, filtered when one kind waits.
export const requestsHref = (workspaceId: string, counts: RequestCounts): string => {
  const kinds = waitingKinds(counts)
  const base = `/workspace/${workspaceId}/users/requests`
  return kinds.length === 1 ? `${base}?kind=${kinds[0]}` : base
}

export type InboxState = {
  kind: RequestKind | null
  // The open panel: an `OpenRequest.id` (`freeze:<uuid>`, …).
  request: string | null
}

export const parseInboxSearch = (search: string): InboxState => {
  const params = new URLSearchParams(search)
  const kind = params.get("kind")
  return {
    kind: REQUEST_KINDS.find((k) => k === kind) ?? null,
    request: params.get("request") || null,
  }
}

export const inboxSearch = (state: InboxState): string => {
  const params = new URLSearchParams()
  if (state.kind) params.set("kind", state.kind)
  if (state.request) params.set("request", state.request)
  const query = params.toString()
  return query ? `?${query}` : ""
}

// «0:42», «12:05» — a moment of the clip.
export const formatClipTime = (sec: number): string => {
  const whole = Math.max(0, Math.floor(sec))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

// The empty list, after a successful load.
export const emptyInboxText = (kind: RequestKind | null): string =>
  kind ? "Заявок этого вида нет" : "Новых заявок нет"
