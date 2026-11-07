import type {
  BottomTabNavigationProp,
  BottomTabScreenProps,
} from "@react-navigation/bottom-tabs"
import {
  createNavigationContainerRef,
  type CompositeNavigationProp,
  type CompositeScreenProps,
  type NavigatorScreenParams,
} from "@react-navigation/native"
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack"

// The bottom tabs. Each is a top-level destination; every other screen lives on
// the root stack above them, so a pushed screen covers the tab bar.
export type MainTabParamList = {
  Home: undefined
  Schedule: undefined
  Courses: undefined
  Progress: undefined
  Profile: undefined
}

export type RootStackParamList = {
  SignIn: undefined
  // Signed in with no club yet: join by code, or wait for an approval.
  Onboarding: undefined
  JoinClub: { code?: string } | undefined
  ScanJoinQr: undefined
  Main: NavigatorScreenParams<MainTabParamList> | undefined
  CourseDetail: { courseId: string; title?: string }
  // fullscreen: open straight into the player's fullscreen mode (autoplaying
  // the next lesson from fullscreen keeps it).
  // startAt: start here (seconds) instead of the resume position — a bookmark
  // opened from «Мои заметки»; with loopEndAt it's a segment, looped A–B.
  Video: {
    videoId: string
    courseId?: string
    title?: string
    fullscreen?: boolean
    startAt?: number
    loopEndAt?: number
    // Opened on a bookmark with a drawing (startAt = its moment): stay paused
    // there with the drawing shown.
    drawingBookmarkId?: string
    // Playing a study plan: its id and the item on screen (startAt is the
    // item's start); a segment item moves on to the next item at its end.
    planId?: string
    planItemIndex?: number
  }
  // «Сравнить рядом»: this lesson on the left from `startAt` (an A–B segment
  // with `endAt`); the right side is picked on the screen.
  Compare: {
    videoId: string
    title?: string
    startAt?: number
    endAt?: number
  }
  Notifications: undefined
  OfflineLibrary: undefined
  Settings: undefined
  ContinueWatching: undefined
  Favorites: undefined
  // The member's lesson notes and bookmarks across the club, searchable.
  MyVideoNotes: undefined
  // «Повторение»: spaced repetition of those bookmarks, one card at a time.
  Reviews: undefined
  // «Разбор видео»: the member's own clips sent to the coaches, the staff's
  // list of them, sending one, and one request (clip + comments).
  MyVideoReviews: undefined
  ClubVideoReviews: undefined
  NewVideoReview: undefined
  VideoReview: { requestId: string; title?: string }
  // «Мои планы»: the member's study plans, and one plan's items.
  StudyPlans: undefined
  StudyPlan: { planId: string; title?: string }
  // «Поиск по видео»: what's said, chapter and video titles; `q` prefilled.
  VideoSearch: { q?: string } | undefined
  // «Техники»: the club sport's techniques taught in lessons; one technique.
  Techniques: undefined
  Technique: { key: string; title?: string }
  MyGroups: undefined
  Gyms: undefined
  // `eventId`: scroll to and mark that event (Home's «Ближайшее событие»).
  Events: { eventId?: string } | undefined
  ClubAbout: undefined
  SessionAttendance: {
    slotId: string
    sessionDate: string
    groupName?: string
  }
  // The coach's view of a personal session, opened by id (no slot to resolve).
  SessionRoster: { sessionId: string; title?: string }
  // The teacher's / staff view of an event's session (resolved or created).
  EventAttendance: { eventId: string; title?: string }
  PersonalTrainings: undefined
  PersonalTrainingRequest: undefined
  PersonalTraining: { requestId: string }
  MyAttendance: undefined
  // The member's places in booking-mode classes: upcoming + history.
  MyClassBookings: undefined
  CheckIn: undefined
  MySubscription: undefined
  MyRanks: undefined
  Achievements: undefined
  Journal: undefined
  Announcements: undefined
  Leaderboard: undefined
  AtRiskMembers: undefined
  // The coach's view of one student's abonement (sell, mark paid, freeze).
  MemberSubscription: { userId: string }
  ClubInvite: { workspaceId?: string } | undefined
  // Offers from clubs to join them; reachable with or without a club.
  Invitations: undefined
  // My membership in one club: mute its notifications, leave it.
  ClubSettings: { workspaceId: string }
  // The week ahead across all my clubs.
  Agenda: undefined
  // Where the payment provider's page returns the member (web: /payment/<id>).
  PaymentReturn: { paymentId: string }
  // The guardian's children: add, confirm a club's invitation, switch to one.
  Children: undefined
}

// Ref so code outside the React tree (e.g. a push-notification tap handler)
// can drive navigation.
export const navigationRef = createNavigationContainerRef<RootStackParamList>()

/** Props of a screen that is one of the bottom tabs. */
export type TabScreenProps<T extends keyof MainTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, T>,
    NativeStackScreenProps<RootStackParamList>
  >

/** `useNavigation` type for a component rendered inside a tab. */
export type AppNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>

// A bare name no longer finds a screen inside the tab navigator, and a stack
// `navigate` to a route it already holds would push a second tab bar —
// `pop: true` returns to the existing one.
export const navigateToTab = (tab: keyof MainTabParamList) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate("Main", { screen: tab }, { pop: true })
  }
}
