import type Ionicons from "@expo/vector-icons/Ionicons"

import type { AppFeatureKey } from "../shared/feature-flags"
import type { RootStackParamList } from "./navigation"

/**
 * The member-facing sections of the app, in one list.
 *
 * Two things render it: the Profile screen's row list (the only way into these
 * screens on a phone) and the desktop sidebar. Keeping one definition means
 * adding a section — or gating one behind a workspace feature flag — happens
 * once instead of drifting between the two.
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
      (!section.nativeOnly || supportsNativeOnly),
  )

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  training: "Обучение",
  club: "Клуб",
  progress: "Прогресс",
  account: "Аккаунт",
}

// Order is the Profile screen's, which members already know.
export const MEMBER_SECTIONS: readonly NavSection[] = [
  {
    route: "CheckIn",
    icon: "checkmark-circle-outline",
    label: "Отметиться на тренировке",
    shortLabel: "Отметиться",
    feature: "attendance",
    group: "club",
  },
  {
    route: "Notifications",
    icon: "notifications-outline",
    label: "Уведомления",
    group: "account",
  },
  {
    route: "Announcements",
    icon: "megaphone-outline",
    label: "Анонсы",
    feature: "announcements",
    group: "club",
  },
  {
    route: "OfflineLibrary",
    icon: "download-outline",
    label: "Загруженные видео",
    nativeOnly: true,
    group: "training",
  },
  {
    route: "ContinueWatching",
    icon: "play-circle-outline",
    label: "Продолжить просмотр",
    shortLabel: "Продолжить",
    group: "training",
  },
  {
    route: "Favorites",
    icon: "heart-outline",
    label: "Избранное",
    group: "training",
  },
  {
    route: "MyGroups",
    icon: "people-outline",
    label: "Мои группы",
    feature: "groups",
    group: "club",
  },
  {
    route: "ClubSchedule",
    icon: "calendar-outline",
    label: "Расписание клуба",
    shortLabel: "Расписание",
    feature: "schedule",
    group: "club",
  },
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
    feature: "attendance",
    group: "progress",
  },
  {
    route: "Journal",
    icon: "book-outline",
    label: "Дневник тренировок",
    shortLabel: "Дневник",
    feature: "attendance",
    group: "progress",
  },
  {
    route: "MySubscription",
    icon: "card-outline",
    label: "Мой абонемент",
    shortLabel: "Абонемент",
    feature: "subscription",
    group: "account",
  },
  // No "Мой ранг" row: the rank card on the Profile screen shows the current
  // rank and opens the same screen (history) — a second entry was a duplicate.
  {
    route: "Events",
    icon: "flag-outline",
    label: "События",
    feature: "events",
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
    route: "Settings",
    icon: "settings-outline",
    label: "Настройки",
    group: "account",
  },
]

/**
 * The sidebar's own entries: the course list is the app's home (the Profile
 * screen doesn't list it because it *is* the way back), and Profile itself
 * becomes a destination once the sidebar has taken over its navigation job.
 */
export const SIDEBAR_SECTIONS: readonly NavSection[] = [
  {
    route: "Courses",
    icon: "albums-outline",
    label: "Курсы",
    group: "training",
  },
  ...MEMBER_SECTIONS,
  {
    route: "Profile",
    icon: "person-circle-outline",
    label: "Профиль",
    group: "account",
  },
]

export const sectionLabel = (section: NavSection): string =>
  section.shortLabel ?? section.label
