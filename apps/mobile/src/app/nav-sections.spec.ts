import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { AppFeatureKey } from "../shared/feature-flags"
import {
  HOME_SECTIONS,
  PROFILE_SECTIONS,
  PROGRESS_SECTIONS,
  SIDEBAR_SECTIONS,
  sectionLabel,
  visibleSections as visibleSectionsIn,
  type NavSection,
} from "./nav-sections"

const allOn = () => true
// The academy's words; the dance studio's are checked in «section labels».
const SPORT = vocabularyForWorkspaceType("GRAPPLING")
const visibleSections = (
  sections: readonly NavSection[],
  isFeatureOn: (key: AppFeatureKey) => boolean,
  offlineDownloadsAllowed: boolean,
  canSeeInvite?: boolean,
) => visibleSectionsIn(sections, SPORT, isFeatureOn, offlineDownloadsAllowed, canSeeInvite)

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
      "ClubAbout",
      "PersonalTrainings",
      "ClubInvite",
      "Favorites",
      "OfflineLibrary",
      "Settings",
    ])
  })

  it("never calls an event an «ивент»", () => {
    for (const section of visibleSections(SIDEBAR_SECTIONS, allOn, true, true)) {
      expect(section.label.toLowerCase()).not.toContain("ивент")
    }
  })
})

describe("section labels", () => {
  const labels = (type: string) =>
    visibleSectionsIn(SIDEBAR_SECTIONS, vocabularyForWorkspaceType(type), allOn, true, true)
      .filter((s) => ["CheckIn", "Journal", "PersonalTrainings"].includes(s.route))
      .map((s) => [s.label, sectionLabel(s)])

  it("keeps the academy's labels", () => {
    expect(labels("GRAPPLING")).toEqual([
      ["Отметиться на тренировке", "Отметиться"],
      ["Дневник тренировок", "Дневник"],
      ["Персональные тренировки", "Персональные"],
    ])
  })

  it("speaks of classes in a dance studio", () => {
    expect(labels("DANCE")).toEqual([
      ["Отметиться на занятии", "Отметиться"],
      ["Дневник занятий", "Дневник"],
      ["Индивидуальные занятия", "Индивидуальные"],
    ])
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
      needsOfflineDownloads: true,
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

  it("drops the offline library where downloads aren't offered", () => {
    const routes = visibleSections(sections, allOn, false).map((s) => s.route)
    expect(routes).not.toContain("OfflineLibrary")
    expect(routes).toEqual(["Settings", "MyRanks"])
  })

  it("shows the club invite row only when the caller may see it", () => {
    const invite: NavSection[] = [
      {
        route: "ClubInvite",
        label: "Пригласить в клуб",
        clubInviteOnly: true,
        group: "club",
      },
    ]
    expect(visibleSections(invite, allOn, true)).toHaveLength(0)
    expect(visibleSections(invite, allOn, true, true)).toHaveLength(1)
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

describe("sections behind the videos, achievements and journal flags", () => {
  const routesWith = (off: string) =>
    visibleSections(
      [...HOME_SECTIONS, ...PROGRESS_SECTIONS, ...PROFILE_SECTIONS],
      (key) => key !== off,
      true,
    ).map((s) => s.route)

  it("hides the video rows when videos are off", () => {
    const routes = routesWith("videos")
    expect(routes).not.toContain("ContinueWatching")
    expect(routes).not.toContain("Favorites")
    expect(routes).not.toContain("OfflineLibrary")
    expect(routes).toContain("Achievements")
  })

  it("hides Achievements when achievements are off", () => {
    expect(routesWith("achievements")).not.toContain("Achievements")
    expect(routesWith("achievements")).toContain("Journal")
  })

  it("hides the Journal when the journal is off", () => {
    expect(routesWith("journal")).not.toContain("Journal")
    expect(routesWith("journal")).toContain("Achievements")
  })
})
