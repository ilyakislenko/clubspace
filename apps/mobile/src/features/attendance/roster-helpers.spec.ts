import type { VisitAbonement } from "../../shared/api/attendance"
import {
  abonementDetail,
  abonementLabel,
  abonementOverrides,
  canChooseAbonement,
  checkInAbonementLine,
  checkInNeedsChoice,
  shownAbonement,
  splitRoster,
  withoutChoices,
} from "./roster-helpers"

const entry = (userId: string, present: boolean) =>
  ({ userId, displayName: userId, present, isGuest: false }) as never
const guest = (userId: string, present: boolean) => ({
  userId,
  displayName: userId,
  present,
  source: "booking" as const,
  frozenUntil: null,
  classesLeft: null,
})

describe("splitRoster", () => {
  it("leaves a roster without guests as it is", () => {
    const out = splitRoster({
      sessionId: "s",
      kind: "scheduled",
      checkInCode: null,
      roster: [entry("a", true), entry("b", false)],
      expected: [],
    } as never)
    expect(out.main).toHaveLength(2)
    expect(out.presentCount).toBe(1)
    expect(out.total).toBe(2)
    expect(out.markAllIds).toEqual(["b"])
  })

  it("lists a marked guest once and counts them", () => {
    const out = splitRoster({
      roster: [entry("a", false), entry("g1", true)],
      expected: [guest("g1", true), guest("g2", false)],
    } as never)
    expect(out.main.map((e) => e.userId)).toEqual(["a"])
    expect(out.expected.map((g) => g.userId)).toEqual(["g1", "g2"])
    expect(out.presentCount).toBe(1)
    expect(out.total).toBe(3)
  })

  it("carries a guest's frozenUntil and classesLeft through the dedupe", () => {
    const out = splitRoster({
      roster: [entry("g1", true)],
      expected: [
        { ...guest("g1", true), frozenUntil: "2026-11-05", classesLeft: 0 },
      ],
    } as never)
    expect(out.main).toEqual([])
    expect(out.expected[0]).toMatchObject({
      userId: "g1",
      frozenUntil: "2026-11-05",
      classesLeft: 0,
    })
  })

  it("never marks guests in bulk", () => {
    const out = splitRoster({
      roster: [entry("a", false), entry("b", true)],
      expected: [guest("g1", false)],
    } as never)
    expect(out.markAllIds).toEqual(["a"])
  })

  it("lists a personal session's one member once, with nothing to mark in bulk", () => {
    const out = splitRoster({
      kind: "personal",
      roster: [entry("m1", true)],
      expected: [{ ...guest("m1", true), source: "personal" as const }],
    } as never)
    expect(out.main).toEqual([])
    expect(out.expected).toHaveLength(1)
    expect(out.presentCount).toBe(1)
    expect(out.total).toBe(1)
    expect(out.markAllIds).toEqual([])
  })

  it("tolerates a roster without expected", () => {
    const out = splitRoster({ roster: [entry("a", false)] } as never)
    expect(out.expected).toEqual([])
    expect(out.total).toBe(1)
  })
})

const ab = (
  subscriptionId: string,
  over: Partial<VisitAbonement> = {},
): VisitAbonement => ({
  subscriptionId,
  planName: "БЖЖ 12",
  classesTotal: 12,
  classesRemaining: 5,
  endDate: null,
  directions: [],
  ...over,
})

const slot = (userId: string, present: boolean, options: VisitAbonement[]) => ({
  userId,
  present,
  abonement: options[0] ?? null,
  abonementOptions: options,
})

describe("abonementLabel / abonementDetail", () => {
  it("names a pack with what is left, a time-based one by name only", () => {
    expect(abonementLabel(ab("p"))).toBe("БЖЖ 12 · осталось 5")
    expect(
      abonementLabel(
        ab("t", { planName: "Безлимит", classesTotal: null, classesRemaining: null }),
      ),
    ).toBe("Безлимит")
  })

  it("details remaining of total and the end date, or nothing", () => {
    expect(abonementDetail(ab("p"))).toBe("осталось 5 из 12")
    const dated = abonementDetail(ab("p", { endDate: "2026-11-30T12:00:00.000Z" }))
    expect(dated).toMatch(/^осталось 5 из 12 · до 30 ноября 2026/)
    expect(
      abonementDetail(ab("t", { classesTotal: null, classesRemaining: null })),
    ).toBeNull()
  })
})

describe("canChooseAbonement", () => {
  it("shows the chip only with two or more options", () => {
    expect(canChooseAbonement(slot("a", false, [ab("1"), ab("2")]), "scheduled")).toBe(true)
    expect(canChooseAbonement(slot("a", true, [ab("1")]), "scheduled")).toBe(false)
    expect(canChooseAbonement(slot("a", false, []), "scheduled")).toBe(false)
  })

  it("never for a personal session or a roster cached before the field", () => {
    expect(canChooseAbonement(slot("a", false, [ab("1"), ab("2")]), "personal")).toBe(false)
    expect(canChooseAbonement({ userId: "a", present: false }, "scheduled")).toBe(false)
  })
})

describe("shownAbonement", () => {
  const options = [ab("1"), ab("2", { planName: "ММА 8" })]

  it("shows an unmarked member's local pick while it is still offered", () => {
    expect(shownAbonement(slot("a", false, options), { a: "2" })?.subscriptionId).toBe("2")
    expect(shownAbonement(slot("a", false, options), { a: "gone" })?.subscriptionId).toBe("1")
    expect(shownAbonement(slot("a", false, options), {})?.subscriptionId).toBe("1")
  })

  it("shows what a marked visit was spent on, ignoring a stale pick", () => {
    expect(shownAbonement(slot("a", true, options), { a: "2" })?.subscriptionId).toBe("1")
  })

  it("is null without an abonement", () => {
    expect(shownAbonement(slot("a", false, []), {})).toBeNull()
  })
})

describe("abonementOverrides", () => {
  const entries = [
    slot("a", false, [ab("a1"), ab("a2")]),
    slot("b", false, [ab("b1"), ab("b2")]),
    slot("c", false, [ab("c1")]),
  ]

  it("sends nothing without picks (the request stays as before)", () => {
    expect(abonementOverrides(["a", "b", "c"], entries, {})).toEqual([])
  })

  it("sends only the picks that differ from the default, for the marked ids", () => {
    expect(
      abonementOverrides(["a", "b"], entries, { a: "a2", b: "b1", c: "c1" }),
    ).toEqual([{ userId: "a", subscriptionId: "a2" }])
  })

  it("drops a pick no longer offered and members outside the mark", () => {
    expect(abonementOverrides(["a"], entries, { a: "gone", b: "b2" })).toEqual([])
    expect(abonementOverrides(["x"], entries, { x: "a2" })).toEqual([])
  })
})

describe("withoutChoices", () => {
  it("forgets the picks of the given members only", () => {
    expect(withoutChoices({ a: "1", b: "2" }, ["a"])).toEqual({ b: "2" })
  })
})

describe("checkInNeedsChoice", () => {
  const preview = (options: VisitAbonement[], alreadyCheckedIn = false) => ({
    sessionId: "s",
    sessionTitle: "БЖЖ",
    startAt: "2026-11-01T10:00:00.000Z",
    alreadyCheckedIn,
    abonement: options[0] ?? null,
    abonementOptions: options,
  })

  it("checks in straight away with one abonement or none", () => {
    expect(checkInNeedsChoice(preview([ab("1")]))).toBe(false)
    expect(checkInNeedsChoice(preview([]))).toBe(false)
  })

  it("asks with two or more, unless already checked in", () => {
    expect(checkInNeedsChoice(preview([ab("1"), ab("2")]))).toBe(true)
    expect(checkInNeedsChoice(preview([ab("1"), ab("2")], true))).toBe(false)
  })
})

describe("checkInAbonementLine", () => {
  it("names the pack and what is left, or the time-based abonement", () => {
    expect(checkInAbonementLine(ab("p", { classesRemaining: 4 }))).toBe(
      "Списано с «БЖЖ 12» · осталось 4",
    )
    expect(
      checkInAbonementLine(
        ab("t", { planName: "Безлимит", classesTotal: null, classesRemaining: null }),
      ),
    ).toBe("Посещение по абонементу «Безлимит»")
  })
})
