import {
  TAB_SPECS,
  isTabRoute,
  scheduleTabContent,
  tabTitle,
  visibleTabs,
} from "./tab-routes"

const names = (isOn: (key: string) => boolean) =>
  visibleTabs(isOn as never).map((t) => t.name)

describe("TAB_SPECS", () => {
  it("lists the five tabs in bar order", () => {
    expect(TAB_SPECS.map((t) => t.name)).toEqual([
      "Home",
      "Schedule",
      "Courses",
      "Progress",
      "Profile",
    ])
  })
})

describe("visibleTabs", () => {
  it("shows everything when every section is on", () => {
    expect(names(() => true)).toHaveLength(5)
  })

  it("always keeps Home and Profile", () => {
    expect(names(() => false)).toEqual(["Home", "Profile"])
  })

  it("drops the Video tab when videos are off, keeping a sane tab set", () => {
    expect(names((k) => k !== "videos")).toEqual([
      "Home",
      "Schedule",
      "Progress",
      "Profile",
    ])
  })

  it("keeps Schedule while either schedule or groups is on", () => {
    expect(names((k) => k === "schedule")).toContain("Schedule")
    expect(names((k) => k === "groups")).toContain("Schedule")
    expect(names((k) => k === "events")).not.toContain("Schedule")
  })

  it("keeps Progress while any of its sections is on", () => {
    for (const key of ["attendance", "leaderboard", "ranks", "journal"]) {
      expect(names((k) => k === key)).toContain("Progress")
    }
    expect(names((k) => k === "announcements")).not.toContain("Progress")
  })

  it("drops Progress when only achievements is on (nothing there would render)", () => {
    expect(names((k) => k === "achievements")).not.toContain("Progress")
  })
})

describe("scheduleTabContent", () => {
  it("is the club schedule when that section is on", () => {
    expect(scheduleTabContent(() => true)).toBe("ClubSchedule")
  })

  it("falls back to the member's groups when the schedule is off", () => {
    expect(scheduleTabContent((k) => k !== "schedule")).toBe("MyGroups")
  })
})

describe("tabTitle", () => {
  it("defaults to the home tab before the navigator has reported one", () => {
    expect(tabTitle(undefined)).toBe("Главная")
  })

  it("names the focused tab", () => {
    expect(tabTitle("Courses")).toBe("Видео")
    expect(tabTitle("Profile")).toBe("Профиль")
  })
})

describe("isTabRoute", () => {
  it("separates tabs from pushed screens", () => {
    expect(isTabRoute("Progress")).toBe(true)
    expect(isTabRoute("Settings")).toBe(false)
    expect(isTabRoute(undefined)).toBe(false)
  })
})
