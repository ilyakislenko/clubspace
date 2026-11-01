import type { Achievement, Achievements } from "../../shared/api/achievements"
import {
  achievementSections,
  directionsOf,
  filterByDirection,
  resolveDirectionFilter,
} from "./direction-helpers"

const bjj = { id: "d1", name: "БЖЖ", color: "#1E88E5", icon: "🥋" }
const mma = { id: "d2", name: "ММА", color: null, icon: null }

const badge = (over: Partial<Achievement>): Achievement => ({
  id: "a",
  name: "Веха",
  description: null,
  icon: null,
  metric: "checkins",
  threshold: 10,
  unlocked: false,
  achievedAt: null,
  directionId: null,
  ...over,
})

const achievements = (over: Partial<Achievements> = {}): Achievements => ({
  totalCheckIns: 12,
  currentStreakWeeks: 2,
  longestStreakWeeks: 5,
  nextMilestone: 25,
  achievements: [],
  directions: [],
  recentWeeks: [],
  stats: {
    firstTrainingDate: null,
    monthsTraining: 0,
    avgPerMonth: 0,
    completedSubscriptions: 0,
  },
  ...over,
})

describe("resolveDirectionFilter", () => {
  it("keeps a listed direction", () => {
    expect(resolveDirectionFilter("d1", [bjj, mma])).toBe("d1")
  })
  it("falls back to «Все» for none or a vanished one", () => {
    expect(resolveDirectionFilter(null, [bjj])).toBeNull()
    expect(resolveDirectionFilter("gone", [bjj])).toBeNull()
  })
})

describe("directionsOf / filterByDirection", () => {
  const rows = [
    { id: "1", direction: bjj },
    { id: "2", direction: null },
    { id: "3", direction: mma },
    { id: "4", direction: bjj },
    { id: "5" },
  ]
  it("lists distinct directions in order", () => {
    expect(directionsOf(rows)).toEqual([bjj, mma])
  })
  it("filters by direction id, null keeps all", () => {
    expect(filterByDirection(rows, "d1").map((r) => r.id)).toEqual(["1", "4"])
    expect(filterByDirection(rows, null)).toHaveLength(5)
  })
})

describe("achievementSections", () => {
  it("is null without directions (flat list as before)", () => {
    expect(
      achievementSections(achievements({ achievements: [badge({})] })),
    ).toBeNull()
  })

  it("splits «Общие» + per direction with the direction's own totals", () => {
    const sections = achievementSections(
      achievements({
        achievements: [
          badge({ id: "g1" }),
          badge({ id: "b1", directionId: "d1", threshold: 5, unlocked: true }),
          badge({ id: "b2", directionId: "d1", threshold: 20 }),
          badge({ id: "b3", directionId: "d1", threshold: 50 }),
        ],
        directions: [
          {
            ...bjj,
            totalCheckIns: 7,
            currentStreakWeeks: 1,
            longestStreakWeeks: 3,
          },
          {
            ...mma,
            totalCheckIns: 2,
            currentStreakWeeks: 0,
            longestStreakWeeks: 1,
          },
        ],
      }),
    )!
    expect(sections.map((s) => s.key)).toEqual(["general", "d1"])
    expect(sections[0]).toMatchObject({ direction: null, totalCheckIns: 12, nextMilestone: 25 })
    expect(sections[1].achievements.map((a) => a.id)).toEqual(["b1", "b2", "b3"])
    expect(sections[1]).toMatchObject({ totalCheckIns: 7, longestStreakWeeks: 3, nextMilestone: 20 })
  })
})
