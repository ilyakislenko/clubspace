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

export type NavSection = {
  route: ParamlessRoute
  /** Row label on the Profile screen. */
  label: string
  /** Sidebar label — the column is narrow, so long labels get a short form. */
  shortLabel?: string
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
    label: "Отметиться на тренировке",
    shortLabel: "Отметиться",
    feature: "attendance",
    group: "club",
  },
  { route: "Notifications", label: "Уведомления", group: "account" },
  {
    route: "Announcements",
    label: "Анонсы",
    feature: "announcements",
    group: "club",
  },
  {
    route: "OfflineLibrary",
    label: "Загруженные видео",
    nativeOnly: true,
    group: "training",
  },
  {
    route: "ContinueWatching",
    label: "Продолжить просмотр",
    shortLabel: "Продолжить",
    group: "training",
  },
  { route: "Favorites", label: "Избранное", group: "training" },
  {
    route: "MyGroups",
    label: "Мои группы",
    feature: "groups",
    group: "club",
  },
  {
    route: "ClubSchedule",
    label: "Расписание клуба",
    shortLabel: "Расписание",
    feature: "schedule",
    group: "club",
  },
  {
    route: "MyAttendance",
    label: "Моя посещаемость",
    shortLabel: "Посещаемость",
    feature: "attendance",
    group: "progress",
  },
  {
    route: "Leaderboard",
    label: "Рейтинг",
    feature: "leaderboard",
    group: "progress",
  },
  {
    route: "Achievements",
    label: "Достижения",
    feature: "attendance",
    group: "progress",
  },
  {
    route: "Journal",
    label: "Дневник тренировок",
    shortLabel: "Дневник",
    feature: "attendance",
    group: "progress",
  },
  {
    route: "MySubscription",
    label: "Мой абонемент",
    shortLabel: "Абонемент",
    feature: "subscription",
    group: "account",
  },
  { route: "MyRanks", label: "Мой ранг", feature: "ranks", group: "progress" },
  { route: "Events", label: "Ивенты", feature: "events", group: "club" },
  {
    route: "Gyms",
    label: "Залы клуба",
    shortLabel: "Залы",
    feature: "groups",
    group: "club",
  },
  { route: "Settings", label: "Настройки", group: "account" },
]

/**
 * The sidebar's own entries: the course list is the app's home (the Profile
 * screen doesn't list it because it *is* the way back), and Profile itself
 * becomes a destination once the sidebar has taken over its navigation job.
 */
export const SIDEBAR_SECTIONS: readonly NavSection[] = [
  { route: "Courses", label: "Курсы", group: "training" },
  ...MEMBER_SECTIONS,
  { route: "Profile", label: "Профиль", group: "account" },
]

export const sectionLabel = (section: NavSection): string =>
  section.shortLabel ?? section.label
