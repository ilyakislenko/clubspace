import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import { rankProgressLine as rankProgressLineIn } from "./rank-progress"

const SPORT = vocabularyForWorkspaceType("GRAPPLING")
const rankProgressLine = (entry: Parameters<typeof rankProgressLineIn>[0]) =>
  rankProgressLineIn(entry, SPORT)

const base = {
  upcomingGrading: null,
  ready: false,
  rule: null,
  remainingText: null,
  nextLevel: { id: "b", name: "Синий", color: null },
}

describe("rankProgressLine", () => {
  it("prefers the grading the member is listed for", () => {
    expect(
      rankProgressLine({
        ...base,
        ready: true,
        upcomingGrading: {
          gradingId: "g",
          date: "2026-11-15",
          title: "Аттестация",
          gymName: "Зал на Ленина",
          levelName: "Синий",
        },
      }),
    ).toEqual({ title: "Аттестация 15 ноября: Синий", caption: "Зал на Ленина" })
  })

  it("tells a ready member to ask the coach", () => {
    expect(rankProgressLine({ ...base, ready: true })).toEqual({
      title: "Готовы к аттестации на «Синий» — скажите тренеру",
      caption: null,
    })
  })

  it("sends a ready dancer to the teacher", () => {
    expect(
      rankProgressLineIn({ ...base, ready: true }, vocabularyForWorkspaceType("DANCE"))?.title,
    ).toBe("Готовы к аттестации на «Синий» — скажите педагогу")
  })

  it("shows what is left of the rule", () => {
    expect(
      rankProgressLine({
        ...base,
        rule: { minVisits: 10, minWeeks: null },
        remainingText: "ещё 3 тренировки",
      }),
    ).toEqual({
      title: "До следующей аттестации: ещё 3 тренировки",
      caption: "Следующий уровень: Синий",
    })
  })

  it("is empty without a rule, a grading or readiness", () => {
    expect(rankProgressLine(base)).toBeNull()
    expect(rankProgressLine({ ...base, nextLevel: null })).toBeNull()
  })
})
