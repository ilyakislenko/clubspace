import {
  MEMBER_SECTIONS,
  SIDEBAR_SECTIONS,
  sectionLabel,
  visibleSections,
  type NavSection,
} from "./nav-sections"

const allOn = () => true

describe("MEMBER_SECTIONS", () => {
  it("has no duplicate destinations", () => {
    const routes = MEMBER_SECTIONS.map((s) => s.route)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it("is what the sidebar builds on, plus the two screens only it links to", () => {
    const sidebarRoutes = SIDEBAR_SECTIONS.map((s) => s.route)
    for (const section of MEMBER_SECTIONS) {
      expect(sidebarRoutes).toContain(section.route)
    }
    expect(sidebarRoutes).toContain("Courses")
    expect(sidebarRoutes).toContain("Profile")
  })
})

describe("visibleSections", () => {
  const sections: NavSection[] = [
    { route: "Settings", label: "Настройки", group: "account" },
    {
      route: "MyRanks",
      label: "Мой ранг",
      feature: "ranks",
      group: "progress",
    },
    {
      route: "OfflineLibrary",
      label: "Загруженные видео",
      nativeOnly: true,
      group: "training",
    },
  ]

  it("keeps sections with no gating", () => {
    expect(
      visibleSections(sections, allOn, true).map((s) => s.route),
    ).toEqual(["Settings", "MyRanks", "OfflineLibrary"])
  })

  it("drops a section whose workspace feature is switched off", () => {
    const routes = visibleSections(
      sections,
      (key) => key !== "ranks",
      true,
    ).map((s) => s.route)
    expect(routes).not.toContain("MyRanks")
    expect(routes).toContain("Settings")
  })

  it("drops native-only sections on the web build", () => {
    const routes = visibleSections(sections, allOn, false).map((s) => s.route)
    expect(routes).not.toContain("OfflineLibrary")
    expect(routes).toEqual(["Settings", "MyRanks"])
  })

  it("defaults a missing feature flag to visible", () => {
    // isFeatureEnabled treats an unknown flag as ON, so an older cached
    // workspace never silently hides a section; this must not undo that.
    expect(
      visibleSections(sections, () => true, true).length,
    ).toBe(sections.length)
  })
})

describe("sectionLabel", () => {
  it("prefers the short form when the sidebar column would clip the long one", () => {
    expect(
      sectionLabel({
        route: "ClubSchedule",
        label: "Расписание клуба",
        shortLabel: "Расписание",
        group: "club",
      }),
    ).toBe("Расписание")
  })

  it("falls back to the full label", () => {
    expect(
      sectionLabel({ route: "Settings", label: "Настройки", group: "account" }),
    ).toBe("Настройки")
  })
})
