import type { RankReadinessEntry } from "../../shared/api/rank-readiness"
import {
  memberName,
  overviewLine,
  readinessDigest,
  showsOwnProgress,
} from "./coach-progress"

const entry = (
  id: string,
  ready: boolean,
  pendingGrading: RankReadinessEntry["pendingGrading"] = null,
): RankReadinessEntry => ({
  userId: id,
  firstname: id,
  lastname: null,
  email: null,
  isOwner: false,
  current: {
    levelId: "l1",
    levelName: "Белый",
    color: "#ffffff",
    stripes: 4,
    reachedAt: "2026-01-01T00:00:00.000Z",
  },
  nextLevel: { id: "l2", name: "Синий", color: "#1d4ed8" },
  rule: { minVisits: 100, minWeeks: null },
  visitsSince: ready ? 120 : 40,
  weeksSince: 40,
  remainingVisits: ready ? 0 : 60,
  remainingWeeks: 0,
  ready,
  remainingText: ready ? null : "ещё 60 тренировок",
  pendingGrading,
})

describe("showsOwnProgress", () => {
  it("always shows a student their own progress", () => {
    expect(showsOwnProgress({ staff: false, totalCheckIns: 0, ranks: 0 })).toBe(true)
  })

  it("hides it from staff who don't train", () => {
    expect(showsOwnProgress({ staff: true, totalCheckIns: 0, ranks: 0 })).toBe(false)
  })

  it("shows it to staff who train or hold a rank", () => {
    expect(showsOwnProgress({ staff: true, totalCheckIns: 3, ranks: 0 })).toBe(true)
    expect(showsOwnProgress({ staff: true, totalCheckIns: 0, ranks: 1 })).toBe(true)
  })
})

describe("memberName", () => {
  it("joins the name, falls back to the email, then to a placeholder", () => {
    expect(memberName({ firstname: "Мария", lastname: "Иванова", email: "m@x.ru" })).toBe(
      "Мария Иванова",
    )
    expect(memberName({ firstname: null, lastname: null, email: "m@x.ru" })).toBe("m@x.ru")
    expect(memberName({ firstname: null, lastname: null, email: null })).toBe("Без имени")
  })
})

describe("readinessDigest", () => {
  const grading = { id: "g1", date: "2026-11-14" }

  it("puts members not yet on a grading first and counts the rest", () => {
    const d = readinessDigest(
      [entry("a", true, grading), entry("b", false), entry("c", true), entry("d", true)],
      2,
    )
    expect(d.shown.map((e) => e.userId)).toEqual(["c", "d"])
    expect(d.more).toBe(1)
    expect(d.ready).toBe(3)
    expect(d.unlisted).toBe(2)
    expect(d.soon).toBe(1)
  })

  it("is empty when nobody is ready", () => {
    const d = readinessDigest([entry("a", false)], 5)
    expect(d.shown).toEqual([])
    expect(d.more).toBe(0)
    expect(d.ready).toBe(0)
    expect(d.soon).toBe(1)
  })
})

describe("overviewLine", () => {
  it("spells the counts in Russian", () => {
    expect(
      overviewLine({ days: 30, sessionsHeld: 21, totalCheckIns: 2, distinctAttendees: 5 }),
    ).toBe("21 тренировка · 2 отметки · 5 учеников")
  })
})
