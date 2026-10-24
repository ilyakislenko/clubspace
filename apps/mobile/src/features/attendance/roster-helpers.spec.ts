import { splitRoster } from "./roster-helpers"

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

  it("tolerates a roster without expected", () => {
    const out = splitRoster({ roster: [entry("a", false)] } as never)
    expect(out.expected).toEqual([])
    expect(out.total).toBe(1)
  })
})
