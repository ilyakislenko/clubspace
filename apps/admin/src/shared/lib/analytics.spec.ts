import type { ChurnRiskMember, CoachStats } from "../api/analytics"
import {
  ANALYTICS_ALL,
  EMPTY_ANALYTICS_FILTER,
  analyticsCoachOptions,
  analyticsGroupOptions,
  analyticsScope,
  bestRetentionCoachId,
  cohortCell,
  fillCellClass,
  formatAverage,
  formatCohortMonth,
  formatPercent,
  heatmapGrid,
  personName,
  rateCellClass,
  slotLabel,
  splitChurnList,
} from "./analytics"

const person = (firstname: string | null, lastname: string | null = null) => ({
  firstname,
  lastname,
  email: null,
})

const group = (
  id: string,
  opts: {
    gymId?: string
    directionId?: string
    coachId: string
    coachName: string
    assistants?: { userId: string; name: string }[]
  },
) => ({
  id,
  gym: opts.gymId ? { id: opts.gymId } : null,
  direction: opts.directionId ? { id: opts.directionId } : null,
  coach: { id: opts.coachId, ...person(opts.coachName) },
  coaches: (opts.assistants ?? []).map((a) => ({
    userId: a.userId,
    ...person(a.name),
  })),
})

const groups = [
  group("g1", { gymId: "gym1", directionId: "d1", coachId: "c1", coachName: "Борис" }),
  group("g2", {
    gymId: "gym2",
    coachId: "c2",
    coachName: "Анна",
    assistants: [{ userId: "c1", name: "Борис" }],
  }),
]

describe("analyticsScope", () => {
  it("drops «all» values and keeps picked ids", () => {
    expect(analyticsScope(EMPTY_ANALYTICS_FILTER)).toEqual({
      gymId: undefined,
      directionId: undefined,
      groupId: undefined,
      coachId: undefined,
    })
    expect(
      analyticsScope({ ...EMPTY_ANALYTICS_FILTER, gymId: "gym1", coachId: "c1" }),
    ).toEqual({
      gymId: "gym1",
      directionId: undefined,
      groupId: undefined,
      coachId: "c1",
    })
  })
})

describe("personName", () => {
  it("joins names and falls back to e-mail, then a dash", () => {
    expect(personName({ firstname: "Иван", lastname: "Петров", email: "i@x" })).toBe(
      "Иван Петров",
    )
    expect(personName({ firstname: null, lastname: null, email: "i@x" })).toBe("i@x")
    expect(personName({ firstname: null, lastname: null, email: null })).toBe("—")
  })
})

describe("analyticsCoachOptions", () => {
  it("lists primary coaches and assistants once each, by name", () => {
    expect(analyticsCoachOptions(groups)).toEqual([
      { id: "c2", name: "Анна" },
      { id: "c1", name: "Борис" },
    ])
  })
})

describe("analyticsGroupOptions", () => {
  it("returns every group without filters", () => {
    expect(analyticsGroupOptions(groups, EMPTY_ANALYTICS_FILTER)).toHaveLength(2)
  })

  it("narrows by gym and direction", () => {
    const f = { ...EMPTY_ANALYTICS_FILTER, gymId: "gym2" }
    expect(analyticsGroupOptions(groups, f).map((g) => g.id)).toEqual(["g2"])
    const d = { ...EMPTY_ANALYTICS_FILTER, directionId: "d1" }
    expect(analyticsGroupOptions(groups, d).map((g) => g.id)).toEqual(["g1"])
  })

  it("counts an assistant as the group's coach", () => {
    const f = { ...EMPTY_ANALYTICS_FILTER, coachId: "c1" }
    expect(analyticsGroupOptions(groups, f).map((g) => g.id)).toEqual(["g1", "g2"])
    const only = { ...EMPTY_ANALYTICS_FILTER, coachId: "c2" }
    expect(analyticsGroupOptions(groups, only).map((g) => g.id)).toEqual(["g2"])
  })
})

describe("formatPercent / formatAverage", () => {
  it("rounds rates to whole percent and shows a dash for null", () => {
    expect(formatPercent(0.734)).toBe("73%")
    expect(formatPercent(0)).toBe("0%")
    expect(formatPercent(null)).toBe("—")
  })

  it("prints averages with one decimal", () => {
    expect(formatAverage(4.56)).toBe("4,6")
    expect(formatAverage(7)).toBe("7")
    expect(formatAverage(null)).toBe("—")
  })
})

describe("splitChurnList", () => {
  it("keeps the order and moves recently contacted members aside", () => {
    const m = (userId: string, contactedRecently: boolean) =>
      ({ userId, contactedRecently }) as ChurnRiskMember
    const { toCall, contacted } = splitChurnList([
      m("a", false),
      m("b", true),
      m("c", false),
    ])
    expect(toCall.map((x) => x.userId)).toEqual(["a", "c"])
    expect(contacted.map((x) => x.userId)).toEqual(["b"])
  })
})

describe("cohorts", () => {
  it("finds a cell by offset", () => {
    const row = {
      month: "2026-07",
      size: 10,
      cells: [{ offset: 3, eligible: 10, retained: 6, rate: 0.6, partial: false }],
    }
    expect(cohortCell(row, 3)?.retained).toBe(6)
    expect(cohortCell(row, 6)).toBeUndefined()
  })

  it("names the cohort month", () => {
    expect(formatCohortMonth("2026-07")).toBe("Июль 2026")
    expect(formatCohortMonth("2026-01")).toBe("Январь 2026")
    expect(formatCohortMonth("garbage")).toBe("garbage")
  })

  it("darkens the cell as the rate grows", () => {
    expect(rateCellClass(null)).toBe("")
    expect(rateCellClass(0.1)).toBe("bg-primary/10")
    expect(rateCellClass(0.25)).toBe("bg-primary/20")
    expect(rateCellClass(0.45)).toBe("bg-primary/35")
    expect(rateCellClass(0.65)).toBe("bg-primary/50")
    expect(rateCellClass(0.9)).toContain("bg-primary/70")
  })
})

describe("occupancy", () => {
  it("colours fill from empty to over capacity", () => {
    expect(fillCellClass(null)).toBe("bg-muted")
    expect(fillCellClass(0.2)).toBe("bg-destructive/25")
    expect(fillCellClass(0.5)).toBe("bg-amber-500/30")
    expect(fillCellClass(0.8)).toBe("bg-emerald-500/40")
    expect(fillCellClass(1.2)).toContain("bg-emerald-600/70")
  })

  it("builds a contiguous hour range with a lookup", () => {
    const cell = (dayOfWeek: number, hour: number) => ({
      dayOfWeek,
      hour,
      slots: 1,
      avgAttendance: 5,
      capacity: 10,
      fill: 0.5,
    })
    const grid = heatmapGrid([cell(1, 18), cell(3, 10)])
    expect(grid.hours).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18])
    expect(grid.at(1, 18)?.dayOfWeek).toBe(1)
    expect(grid.at(2, 18)).toBeUndefined()
    expect(heatmapGrid([]).hours).toEqual([])
  })

  it("labels a slot by weekday, time, group and gym", () => {
    expect(
      slotLabel({ dayOfWeek: 1, startTime: "18:00", groupName: "Взрослые", gymName: "Центр" }),
    ).toBe("Пн 18:00 · Взрослые · Центр")
    expect(
      slotLabel({ dayOfWeek: 7, startTime: "10:30", groupName: "Дети", gymName: null }),
    ).toBe("Вс 10:30 · Дети")
  })
})

describe("bestRetentionCoachId", () => {
  const coach = (coachId: string, rate: number | null, eligible: number) =>
    ({ coachId, retention: { rate, eligible, retained: 0 } }) as CoachStats

  it("picks the highest rate among coaches with enough students", () => {
    expect(
      bestRetentionCoachId([coach("a", 0.6, 10), coach("b", 0.8, 5), coach("c", 1, 1)]),
    ).toBe("b")
  })

  it("breaks ties by the larger sample", () => {
    expect(bestRetentionCoachId([coach("a", 0.8, 4), coach("b", 0.8, 9)])).toBe("b")
  })

  it("returns null when nobody qualifies", () => {
    expect(bestRetentionCoachId([coach("a", null, 0), coach("b", 1, 2)])).toBeNull()
    expect(ANALYTICS_ALL).toBe("all")
  })
})
