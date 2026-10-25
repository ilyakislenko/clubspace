import type Ionicons from "@expo/vector-icons/Ionicons"

import type { AppFeatureKey } from "../shared/feature-flags"
import type { RootStackParamList } from "./navigation"

/**
 * The member-facing sections that sit behind the tabs, in three disjoint lists
 * (what the desktop sidebar renders, plus the rows of the Progress and Profile
 * tabs). The tabs themselves are in `tab-routes.ts`. Keeping one definition
 * means adding a section — or gating one behind a workspace feature flag —
 * happens once instead of drifting between the renderers.
 */

// Only screens that take no params can be a nav destination: both renderers
// navigate by name alone.
type ParamlessRoute = {
  [K in keyof RootStackParamList]: RootStackParamList[K] extends undefined
    ? K
    : never
}[keyof RootStackParamList]

export type NavGroup = "training" | "club" | "progress" | "account"

/** An Ionicons glyph name. Type-only import: nothing native loads in tests. */
export type NavIcon = keyof typeof Ionicons.glyphMap

export type NavSection = {
  route: ParamlessRoute
  /** Row label on the Profile screen. */
  label: string
  /** Sidebar label — the column is narrow, so long labels get a short form. */
  shortLabel?: string
  icon?: NavIcon
  /** Hidden when the workspace has this app section switched off. */
  feature?: AppFeatureKey
  /** A second flag that must also be on (both are required). */
  alsoRequires?: AppFeatureKey
  /**
   * Hidden on the web build. For sections backed by a native-only capability —
   * a browser can't stash videos in app storage, so an "offline library" there
   * is a link to a permanently empty screen.
   */
  nativeOnly?: boolean
  group: NavGroup
}

/** The sections to render for this platform + workspace. */
export const visibleSections = (
  sections: readonly NavSection[],
  isFeatureOn: (key: AppFeatureKey) => boolean,
  supportsNativeOnly: boolean,
): NavSection[] =>
  sections.filter(
    (section) =>
      (!section.feature || isFeatureOn(section.feature)) &&
      (!section.alsoRequires || isFeatureOn(section.alsoRequires)) &&
      (!section.nativeOnly || supportsNativeOnly),
  )

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  training: "Обучение",
  club: "Клуб",
  progress: "Прогресс",
  account: "Аккаунт",
}

// Daily gym life. On a phone these live on the Home tab (the check-in button,
// the latest announcement, the bell, the continue-watching row), so only the
// sidebar renders this list.
export const HOME_SECTIONS: readonly NavSection[] = [
  {
    route: "CheckIn",
    icon: "checkmark-circle-outline",
    label: "Отметиться на тренировке",
    shortLabel: "Отметиться",
    feature: "attendance",
    group: "club",
  },
  {
    route: "Announcements",
    icon: "megaphone-outline",
    label: "Объявления",
    feature: "announcements",
    group: "club",
  },
  {
    route: "Notifications",
    icon: "notifications-outline",
    label: "Уведомления",
    group: "account",
  },
  {
    route: "ContinueWatching",
    icon: "play-circle-outline",
    label: "Продолжить просмотр",
    shortLabel: "Продолжить",
    feature: "videos",
    group: "training",
  },
]

// The rows under the Progress tab's summary cards. (The rank card there opens
// "Мой ранг", so it has no row of its own.)
export const PROGRESS_SECTIONS: readonly NavSection[] = [
  {
    route: "MyAttendance",
    icon: "stats-chart-outline",
    label: "Моя посещаемость",
    shortLabel: "Посещаемость",
    feature: "attendance",
    group: "progress",
  },
  {
    route: "Leaderboard",
    icon: "trophy-outline",
    label: "Рейтинг",
    feature: "leaderboard",
    group: "progress",
  },
  {
    route: "Achievements",
    icon: "ribbon-outline",
    label: "Достижения",
    feature: "achievements",
    alsoRequires: "attendance",
    group: "progress",
  },
  {
    route: "Journal",
    icon: "book-outline",
    label: "Дневник тренировок",
    shortLabel: "Дневник",
    feature: "journal",
    group: "progress",
  },
]

// The Profile tab's rows, in order.
export const PROFILE_SECTIONS: readonly NavSection[] = [
  {
    route: "MySubscription",
    icon: "card-outline",
    label: "Мой абонемент",
    shortLabel: "Абонемент",
    feature: "subscription",
    group: "account",
  },
  // With the schedule off, the Schedule tab IS «Мои группы» — a row here would
  // open the same screen a second time.
  {
    route: "MyGroups",
    icon: "people-outline",
    label: "Мои группы",
    feature: "groups",
    alsoRequires: "schedule",
    group: "club",
  },
  {
    route: "Gyms",
    icon: "location-outline",
    label: "Залы клуба",
    shortLabel: "Залы",
    feature: "groups",
    group: "club",
  },
  {
    route: "Events",
    icon: "flag-outline",
    label: "События",
    feature: "events",
    group: "club",
  },
  {
    route: "PersonalTrainings",
    icon: "person-outline",
    label: "Персональные тренировки",
    shortLabel: "Персональные",
    group: "club",
  },
  {
    route: "Favorites",
    icon: "heart-outline",
    label: "Избранное",
    feature: "videos",
    group: "training",
  },
  {
    route: "OfflineLibrary",
    icon: "download-outline",
    label: "Загруженные",
    feature: "videos",
    nativeOnly: true,
    group: "training",
  },
  {
    route: "Settings",
    icon: "settings-outline",
    label: "Настройки",
    group: "account",
  },
]

/** Every section behind the tabs; the sidebar lists the tabs separately. */
export const SIDEBAR_SECTIONS: readonly NavSection[] = [
  ...HOME_SECTIONS,
  ...PROGRESS_SECTIONS,
  ...PROFILE_SECTIONS,
]

export const sectionLabel = (section: NavSection): string =>
  section.shortLabel ?? section.label
