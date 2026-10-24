import {
  HOME_SECTIONS,
  PROFILE_SECTIONS,
  PROGRESS_SECTIONS,
  SIDEBAR_SECTIONS,
  sectionLabel,
  visibleSections,
  type NavSection,
} from "./nav-sections"

const allOn = () => true

describe("section lists", () => {
  it("are disjoint, so a destination is reachable from one place", () => {
    const routes = [
      ...HOME_SECTIONS,
      ...PROGRESS_SECTIONS,
      ...PROFILE_SECTIONS,
    ].map((s) => s.route)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it("make up the sidebar", () => {
    expect(SIDEBAR_SECTIONS.map((s) => s.route)).toEqual([
      ...HOME_SECTIONS,
      ...PROGRESS_SECTIONS,
      ...PROFILE_SECTIONS,
    ].map((s) => s.route))
  })

  it("keeps the Profile rows in the order members know", () => {
    expect(PROFILE_SECTIONS.map((s) => s.route)).toEqual([
      "MySubscription",
      "MyGroups",
      "Gyms",
      "Events",
      "Favorites",
      "OfflineLibrary",
      "Settings",
    ])
  })

  it("never calls an event an «ивент»", () => {
    for (const section of SIDEBAR_SECTIONS) {
      expect(section.label.toLowerCase()).not.toContain("ивент")
    }
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

  it("needs both flags when a section names a second one", () => {
    const gated: NavSection[] = [
      {
        route: "MyGroups",
        label: "Мои группы",
        feature: "groups",
        alsoRequires: "schedule",
        group: "club",
      },
    ]
    expect(visibleSections(gated, allOn, true)).toHaveLength(1)
    expect(
      visibleSections(gated, (key) => key !== "schedule", true),
    ).toHaveLength(0)
    expect(
      visibleSections(gated, (key) => key !== "groups", true),
    ).toHaveLength(0)
  })

  it("hides My groups from Profile when the schedule tab already is it", () => {
    const routes = visibleSections(
      PROFILE_SECTIONS,
      (key) => key !== "schedule",
      true,
    ).map((s) => s.route)
    expect(routes).not.toContain("MyGroups")
    expect(routes).toContain("Gyms")
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
        route: "MyAttendance",
        label: "Моя посещаемость",
        shortLabel: "Посещаемость",
        group: "progress",
      }),
    ).toBe("Посещаемость")
  })

  it("falls back to the full label", () => {
    expect(
      sectionLabel({ route: "Settings", label: "Настройки", group: "account" }),
    ).toBe("Настройки")
  })
})
