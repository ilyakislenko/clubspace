import { eventAt, sessionAt } from "../schedule/calendar/calendar-fixtures"
import { todayItems } from "./today-classes"

// Fixtures are in Asia/Tomsk (UTC+7): 2026-11-04 10:00Z is 17:00 there.
const NOW = new Date("2026-11-04T10:00:00Z")
const TZ = "Asia/Tomsk"

describe("today's classes on «Сегодня»", () => {
  it("takes the club's own day in start order, cancelled ones included", () => {
    const schedule = {
      timezone: TZ,
      sessions: [
        sessionAt("2026-11-04", "19:00", { groupId: "b" }),
        sessionAt("2026-11-04", "08:00", { groupId: "a", cancelled: true }),
        sessionAt("2026-11-03", "19:00", { groupId: "c" }),
        sessionAt("2026-11-05", "08:00", { groupId: "d" }),
      ],
      events: [eventAt("2026-11-04T05:00:00Z", "2026-11-04T07:00:00Z")],
    }
    const { today, items } = todayItems(schedule, NOW, null)
    expect(today).toBe("2026-11-04")
    expect(items.map((it) => it.key)).toEqual(["slot-a:2026-11-04", "event:e1", "slot-b:2026-11-04"])
  })

  it("gives a plain coach their groups and the classes they substitute in", () => {
    const schedule = {
      timezone: TZ,
      sessions: [
        sessionAt("2026-11-04", "18:00", { groupId: "mine", coachId: "other" }),
        sessionAt("2026-11-04", "19:00", { groupId: "theirs", coachId: "other" }),
        sessionAt("2026-11-04", "20:00", {
          groupId: "sub",
          coachId: "other",
          substitution: {
            id: "s1",
            status: "APPROVED",
            substitute: { id: "me", email: null, firstname: "Анна", lastname: "Ким" },
          } as never,
        }),
      ],
      events: [eventAt("2026-11-04T05:00:00Z", "2026-11-04T07:00:00Z")],
    }
    const { items } = todayItems(schedule, NOW, { userId: "me", groupIds: new Set(["mine"]) })
    expect(items.map((it) => it.title)).toEqual(["Группа mine", "Группа sub"])
  })
})
