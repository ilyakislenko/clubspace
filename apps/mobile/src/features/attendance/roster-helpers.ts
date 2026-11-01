import type {
  AbonementOverride,
  RosterEntry,
  SelfCheckInPreview,
  SessionRoster,
  VisitAbonement,
} from "../../shared/api/attendance"
import { fmtDate } from "../subscription/subscription-state"

export type ExpectedGuest = NonNullable<SessionRoster["expected"]>[number]

/**
 * Splits a roster into the group's own members and the guests who booked this
 * class. A guest who is already marked shows up in `roster` too (as «гость»);
 * they are listed once, under «Записались».
 *
 * `markAllIds` (what «Отметить всех» marks) never includes a guest of a fixed
 * group: marking charges their pack, and a drop-in is only a promise to come.
 * In a booking-mode class (`booking` set) it is the other way round: the
 * bookings are the class list, so the booked members not marked yet are
 * preselected and the group's members who didn't book are left out.
 */
export const splitRoster = (
  r: SessionRoster,
): {
  main: RosterEntry[]
  expected: ExpectedGuest[]
  presentCount: number
  total: number
  markAllIds: string[]
} => {
  // Optional: a server that predates drop-ins sends no `expected`.
  const expected = r.expected ?? []
  const guestIds = new Set(expected.map((g) => g.userId))
  const main = r.roster.filter((e) => !guestIds.has(e.userId))
  return {
    main,
    expected,
    presentCount:
      main.filter((e) => e.present).length +
      expected.filter((g) => g.present).length,
    total: main.length + expected.length,
    // Optional: a roster cached before booking-mode classes has no `booking`.
    markAllIds: r.booking
      ? expected
          .filter((g) => g.source === "booking" && !g.present)
          .map((g) => g.userId)
      : main.filter((e) => !e.present).map((e) => e.userId),
  }
}

// The part of a roster / expected entry the abonement choice reads. The
// abonement fields are optional: a roster cached before parallel abonements
// has none.
type AbonementSlot = {
  userId: string
  present: boolean
  abonement?: VisitAbonement | null
  abonementOptions?: VisitAbonement[]
}

/** «БЖЖ 12 · осталось 5»; a time-based abonement is just its name. */
export const abonementLabel = (a: VisitAbonement): string =>
  a.classesRemaining === null
    ? a.planName
    : `${a.planName} · осталось ${a.classesRemaining}`

/**
 * The second line of a picker row: «осталось 5 из 12 · до 30 ноября 2026 г.»
 * — what tells two abonements apart besides their name. Null when there is
 * nothing to add (an open-ended time-based one).
 */
export const abonementDetail = (a: VisitAbonement): string | null => {
  const parts: string[] = []
  if (a.classesRemaining !== null) {
    parts.push(
      a.classesTotal === null
        ? `осталось ${a.classesRemaining}`
        : `осталось ${a.classesRemaining} из ${a.classesTotal}`,
    )
  }
  if (a.endDate) parts.push(`до ${fmtDate(a.endDate)}`)
  return parts.length > 0 ? parts.join(" · ") : null
}

/**
 * Whether the entry gets the abonement chip (and its picker): only when there
 * is a real choice — two or more abonements this visit can be spent on. A
 * member with one abonement (or none) sees the row exactly as before; a
 * personal session is paid for off-app, so it never has one.
 */
export const canChooseAbonement = (
  entry: AbonementSlot,
  kind: SessionRoster["kind"],
): boolean => kind !== "personal" && (entry.abonementOptions?.length ?? 0) >= 2

/**
 * The abonement the chip shows. A marked entry: the one the visit was spent
 * on (a change goes straight to the server). An unmarked one: the coach's
 * not-yet-sent pick when it is still offered, else the server's default.
 */
export const shownAbonement = (
  entry: AbonementSlot,
  choices: Readonly<Record<string, string>>,
): VisitAbonement | null => {
  const picked = entry.present ? undefined : choices[entry.userId]
  const chosen = picked
    ? entry.abonementOptions?.find((o) => o.subscriptionId === picked)
    : undefined
  return chosen ?? entry.abonement ?? null
}

/**
 * The `abonements` overrides to send with a mark of `userIds`: one per member
 * whose local pick is still offered and differs from the default. Everyone
 * else is left to the server's precedence, so a mark without picks sends no
 * overrides at all (the same request as before).
 */
export const abonementOverrides = (
  userIds: readonly string[],
  entries: readonly AbonementSlot[],
  choices: Readonly<Record<string, string>>,
): AbonementOverride[] => {
  const byId = new Map(entries.map((e) => [e.userId, e]))
  const out: AbonementOverride[] = []
  for (const userId of userIds) {
    const picked = choices[userId]
    const entry = byId.get(userId)
    if (!picked || !entry) continue
    if (picked === entry.abonement?.subscriptionId) continue
    if (!entry.abonementOptions?.some((o) => o.subscriptionId === picked)) continue
    out.push({ userId, subscriptionId: picked })
  }
  return out
}

/** Drop the picks of members who were just marked (the server has them now). */
export const withoutChoices = (
  choices: Readonly<Record<string, string>>,
  userIds: readonly string[],
): Record<string, string> => {
  const next = { ...choices }
  for (const id of userIds) delete next[id]
  return next
}

/**
 * Whether self check-in stops to ask which abonement to spend: only for a
 * not-yet-marked member with two or more eligible ones. Otherwise the app
 * checks in straight away, as it always did.
 */
export const checkInNeedsChoice = (preview: SelfCheckInPreview): boolean =>
  !preview.alreadyCheckedIn && (preview.abonementOptions?.length ?? 0) >= 2

/**
 * The check-in result's abonement line, for a member who had several:
 * «Списано с «БЖЖ 12» · осталось 5»; a time-based one only counts the visit.
 */
export const checkInAbonementLine = (a: VisitAbonement): string =>
  a.classesRemaining === null
    ? `Посещение по абонементу «${a.planName}»`
    : `Списано с «${a.planName}» · осталось ${a.classesRemaining}`
