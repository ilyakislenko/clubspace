import type { RosterEntry, SessionRoster } from "../../shared/api/attendance"

export type ExpectedGuest = NonNullable<SessionRoster["expected"]>[number]

/**
 * Splits a roster into the group's own members and the guests who booked this
 * class. A guest who is already marked shows up in `roster` too (as «гость»);
 * they are listed once, under «Записались».
 *
 * `markAllIds` never includes a guest: marking charges their pack, and a
 * booking is only a promise to come.
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
    markAllIds: main.filter((e) => !e.present).map((e) => e.userId),
  }
}
