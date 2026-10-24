import type { AppFeatureKey } from "../shared/feature-flags"
import type { NavIcon } from "./nav-sections"
import type { MainTabParamList } from "./navigation"

/**
 * The bottom tabs, in order.
 *
 * One definition feeds the tab navigator, the desktop sidebar (which hides the
 * tab bar and lists the same destinations) and the document title, so a tab
 * can't be added to one and forgotten in the others.
 */
export type TabSpec = {
  name: keyof MainTabParamList
  label: string
  icon: NavIcon
  iconFocused: NavIcon
  /** Shown when ANY of these workspace sections is on; always shown if unset. */
  anyFeature?: readonly AppFeatureKey[]
  /** Whether the tab draws the navigation header (Home and Video draw their own). */
  header: boolean
}

export const TAB_SPECS: readonly TabSpec[] = [
  {
    name: "Home",
    label: "Главная",
    icon: "home-outline",
    iconFocused: "home",
    header: false,
  },
  {
    name: "Schedule",
    label: "Расписание",
    icon: "calendar-outline",
    iconFocused: "calendar",
    anyFeature: ["schedule", "groups"],
    header: true,
  },
  {
    name: "Courses",
    label: "Видео",
    icon: "play-circle-outline",
    iconFocused: "play-circle",
    header: false,
  },
  {
    name: "Progress",
    label: "Прогресс",
    icon: "stats-chart-outline",
    iconFocused: "stats-chart",
    anyFeature: ["attendance", "leaderboard", "ranks"],
    header: true,
  },
  {
    name: "Profile",
    label: "Профиль",
    icon: "person-circle-outline",
    iconFocused: "person-circle",
    header: true,
  },
]

/** The tabs this workspace shows. */
export const visibleTabs = (
  isOn: (key: AppFeatureKey) => boolean,
): TabSpec[] =>
  TAB_SPECS.filter((tab) => !tab.anyFeature || tab.anyFeature.some(isOn))

/**
 * What the Schedule tab holds: the club schedule, or — when the club has
 * switched that off but still has groups — the member's own groups.
 */
export const scheduleTabContent = (
  isOn: (key: AppFeatureKey) => boolean,
): "ClubSchedule" | "MyGroups" => (isOn("schedule") ? "ClubSchedule" : "MyGroups")

/** Title of the tab named by the navigator state (the first tab until known). */
export const tabTitle = (name?: string): string =>
  TAB_SPECS.find((tab) => tab.name === name)?.label ?? TAB_SPECS[0]!.label

export const isTabRoute = (name: string | undefined): boolean =>
  TAB_SPECS.some((tab) => tab.name === name)
