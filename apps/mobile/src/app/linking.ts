import type { LinkingOptions } from "@react-navigation/native"

import type { MainTabParamList, RootStackParamList } from "./navigation"

/**
 * URL mapping for the web build.
 *
 * A native stack keeps its history in memory, which is exactly right on a phone
 * and exactly wrong in a browser: without this the whole PWA lives at `/`, the
 * browser Back button leaves the site instead of going back a screen, a reload
 * dumps the member back on the course list, and nothing is linkable. Feeding
 * React Navigation a path per screen makes Back/Forward, reload and shared links
 * behave the way a browser user expects.
 *
 * Applied on web only (see App.tsx) — native deep links are a separate product
 * decision and this must not change how the store builds navigate.
 */
export const STACK_PATHS = {
  // Distinct paths, even though the two stacks are never mounted together: a
  // shared "" would make parsing "/" ambiguous, and a signed-out member landing
  // on a readable /sign-in is better than one more thing living at the root.
  SignIn: "sign-in",
  Onboarding: "welcome",
  JoinClub: "join/:code?",
  CourseDetail: "courses/:courseId",
  Video: "video/:videoId",
  Notifications: "notifications",
  OfflineLibrary: "downloads",
  Settings: "settings",
  ContinueWatching: "continue-watching",
  Favorites: "favorites",
  MyGroups: "my-groups",
  Gyms: "gyms",
  Events: "events",
  SessionAttendance: "attendance/:slotId/:sessionDate",
  SessionRoster: "session/:sessionId",
  PersonalTrainings: "personal-trainings",
  PersonalTrainingRequest: "personal-trainings/new",
  PersonalTraining: "personal-trainings/:requestId",
  MyAttendance: "my-attendance",
  CheckIn: "check-in",
  MySubscription: "subscription",
  MyRanks: "ranks",
  Achievements: "achievements",
  Journal: "journal",
  Announcements: "announcements",
  Leaderboard: "leaderboard",
  AtRiskMembers: "at-risk",
} as const satisfies Record<Exclude<keyof RootStackParamList, "Main">, string>

// The bottom tabs, nested under `Main`. Home is the root; the course list moved
// to /courses (it sits next to, not under, /courses/:courseId).
export const TAB_PATHS = {
  Home: "",
  Schedule: "schedule",
  Courses: "courses",
  Progress: "progress",
  Profile: "profile",
} as const satisfies Record<keyof MainTabParamList, string>

/**
 * `<screen> · <app>` — the screen first, because browser tabs and history
 * entries truncate from the right and the app name is the redundant half.
 *
 * The screen title comes from the navigator's `title` option (App.tsx), which is
 * also what React Navigation reads for the header and for the back button's
 * label — so every screen carries one, including the three that hide their
 * header. Falling back to the app name rather than the route name keeps English
 * identifiers like "SignIn" out of a Russian UI.
 */
export const formatDocumentTitle = (
  screenTitle: string | undefined,
  appName: string,
): string => {
  const label = (screenTitle ?? "").trim()
  if (!label || label === appName) return appName
  return `${label} · ${appName}`
}

export const webLinking: LinkingOptions<RootStackParamList> = {
  // Browser-only: the URL origin is the prefix, so there's nothing to declare.
  prefixes: [],
  config: {
    // Someone opening a shared /leaderboard link gets a stack of
    // [Main, Leaderboard], so the header has a real Back button. Without it
    // the deep-linked screen is the only entry in the stack and the only way
    // out is the browser's Back — which leaves the site.
    initialRouteName: "Main",
    screens: {
      ...STACK_PATHS,
      Main: { initialRouteName: "Home", screens: TAB_PATHS },
    },
  },
}
