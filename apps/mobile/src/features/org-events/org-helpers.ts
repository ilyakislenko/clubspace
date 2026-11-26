import type {
  ClubOrgEvent,
  MyClubOrganization,
} from "../../shared/api/organizations"
import { bookedLine } from "../schedule/event-helpers"
import { spotsLine } from "../schedule/class-booking-helpers"

// Federations in the member app (docs/design/2026-11-26-federation-hub-mvp.md
// §5): wording and states shared by «События», the consent switch in the club
// settings, the Home card, «Мой ранг» and the feed.

/**
 * «Федерация «Самбо России»», or the name as is when it already says what it
 * is («Федерация БЖЖ Томской области»).
 */
export const federationLabel = (name: string): string =>
  /^федерац/i.test(name.trim()) ? name.trim() : `Федерация «${name.trim()}»`

// ---- consent ----------------------------------------------------------------

// A guardian acting for a child decides for the child: the words follow.
export const consentSwitchLabel = (forChild: boolean): string =>
  forChild
    ? "Показывать пояс ребёнка и записи федерации"
    : "Показывать мой пояс и записи федерации"

export const consentPrivacyLine = (forChild: boolean): string =>
  forChild
    ? "Федерация увидит имя ребёнка и клуб"
    : "Федерация увидит ваше имя и клуб"

export const consentSheetTitle = (forChild: boolean): string =>
  forChild
    ? "Разрешить федерации видеть пояс ребёнка?"
    : "Разрешить федерации видеть ваш пояс?"

export const consentToast = (granted: boolean): string =>
  granted ? "Федерация видит пояс и записи" : "Федерация больше не видит пояс и записи"

/**
 * The Home card «Клуб вступил в федерацию»: the first federation the person
 * has not decided on and did not put off («Не сейчас», stored on the device
 * per federation). null when there is nothing to ask.
 */
export const pickConsentPrompt = (
  orgs: readonly MyClubOrganization[],
  dismissed: ReadonlySet<string>,
): MyClubOrganization | null =>
  orgs.find((o) => !o.consentGranted && !dismissed.has(o.organizationId)) ??
  null

export const consentCardBody = (forChild: boolean): string =>
  forChild
    ? "Разрешите показывать федерации пояс ребёнка и его записи на её события — пояс появится в реестре федерации с пометкой «подтверждён клубом»."
    : "Разрешите показывать федерации ваш пояс и записи на её события — пояс появится в реестре федерации с пометкой «подтверждён клубом»."

/**
 * «Мой ранг», under one ladder: «Подтверждён клубом ACADEMY · в реестре:
 * Федерация БЖЖ Томской области» while a federation's registry shows the
 * person on that ladder (`registryLadderIds`: consent, the club shares, the
 * ladder is a copy of the federation's standard); null otherwise.
 */
export const registryLine = (
  clubName: string,
  ladderId: string,
  orgs: readonly MyClubOrganization[],
): string | null => {
  const names = orgs.filter((o) => o.registryLadderIds.includes(ladderId)).map((o) => o.name)
  return names.length > 0
    ? `Подтверждён клубом ${clubName} · в реестре: ${names.join(", ")}`
    : null
}

// ---- events -----------------------------------------------------------------

export type OrgEventAction =
  | { kind: "booked"; registrationId: string; canCancel: boolean }
  | { kind: "register" }
  | { kind: "full" }
  | { kind: "closed" }
  // Staff sign their students up for a members' event, not themselves.
  | { kind: "none" }

export const orgEventAction = (
  event: Pick<ClubOrgEvent, "audience" | "registrationState" | "myRegistration">,
  staff: boolean,
): OrgEventAction => {
  const mine = event.myRegistration
  if (mine?.status === "BOOKED") {
    return {
      kind: "booked",
      registrationId: mine.id,
      canCancel: event.registrationState !== "CLOSED",
    }
  }
  if (staff && event.audience === "STAFF_AND_MEMBERS") return { kind: "none" }
  if (event.registrationState === "CLOSED") return { kind: "closed" }
  if (event.registrationState === "FULL") return { kind: "full" }
  return { kind: "register" }
}

// «Записать учеников»: a coach, a members' event still open.
export const canRegisterStudents = (
  event: Pick<ClubOrgEvent, "audience" | "registrationState">,
  staff: boolean,
): boolean =>
  staff &&
  event.audience === "STAFF_AND_MEMBERS" &&
  event.registrationState !== "CLOSED"

// Members read the places left, the staff how many signed up. Once the
// event's tournament runs or is over, registration is closed: no places left
// to offer a member.
export const orgEventPlacesLine = (
  event: Pick<ClubOrgEvent, "capacity" | "bookedCount" | "tournament">,
  staff: boolean,
): string | null => {
  if (staff) {
    return bookedLine({ capacity: event.capacity, booked: event.bookedCount, waitlist: 0 })
  }
  const started = event.tournament?.status === "RUNNING" || event.tournament?.status === "FINISHED"
  return event.capacity === null || started
    ? null
    : spotsLine({ capacity: event.capacity, booked: event.bookedCount, waitlist: 0 })
}

// «12 дек., 10:00 – 18:00» in the event's own time zone (the organiser's
// wall clock), «12 дек., 10:00» without an end.
export const orgEventWhen = (
  startIso: string,
  endIso: string | null,
  tz: string,
): string => {
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short" })
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
  const start = new Date(startIso)
  const head = `${date.format(start)}, ${time.format(start)}`
  if (!endIso) return head
  const end = new Date(endIso)
  return dayKey.format(start) === dayKey.format(end)
    ? `${head} – ${time.format(end)}`
    : `${head} – ${date.format(end)}, ${time.format(end)}`
}

// Where: the place and its address; «Принимает: ACADEMY» for the host club.
export const orgEventWhere = (
  event: Pick<ClubOrgEvent, "place" | "address" | "hostClubName">,
): string | null =>
  [
    [event.place, event.address].filter(Boolean).join(", "),
    event.hostClubName ? `принимает ${event.hostClubName}` : "",
  ]
    .filter(Boolean)
    .join(" · ") || null

/**
 * The events section heading: the federation's name when there is one, else
 * «События федераций» (a club in several).
 */
export const orgEventsTitle = (
  events: readonly Pick<ClubOrgEvent, "organizationName">[],
): string => {
  const names = [...new Set(events.map((e) => e.organizationName))]
  return names.length === 1 ? federationLabel(names[0]) : "События федераций"
}

// The coach's picker: a row is booked (cancellable by this coach, or booked by
// someone else — inert), may be booked, or waits for consent.
export type StudentRowState = "booked" | "bookedLocked" | "available" | "noConsent"

export const studentRowState = (s: {
  consented: boolean
  registration: { status: "BOOKED" | "CANCELLED"; canCancel: boolean } | null
}): StudentRowState =>
  s.registration?.status === "BOOKED"
    ? s.registration.canCancel
      ? "booked"
      : "bookedLocked"
    : s.consented
      ? "available"
      : "noConsent"

// Past this many students the picker gets a search field (a club's coach can
// have a few hundred).
export const STUDENT_SEARCH_THRESHOLD = 12

// The picker's search: every word of the query in the name, case- and
// «ё»-insensitive.
export const filterStudentsByName = <T extends { name: string }>(students: readonly T[], query: string): T[] => {
  const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е")
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...students]
  return students.filter((s) => {
    const name = fold(s.name)
    return words.every((w) => name.includes(w))
  })
}
