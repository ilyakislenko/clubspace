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
  Main: NavigatorScreenParams<MainTabParamList> | undefined
  CourseDetail: { courseId: string; title?: string }
  Video: { videoId: string; courseId?: string; title?: string }
  Notifications: undefined
  OfflineLibrary: undefined
  Settings: undefined
  ContinueWatching: undefined
  Favorites: undefined
  MyGroups: undefined
  Gyms: undefined
  Events: undefined
  ClubAbout: undefined
  SessionAttendance: {
    slotId: string
    sessionDate: string
    groupName?: string
  }
  // The coach's view of a personal session, opened by id (no slot to resolve).
  SessionRoster: { sessionId: string; title?: string }
  PersonalTrainings: undefined
  PersonalTrainingRequest: undefined
  PersonalTraining: { requestId: string }
  MyAttendance: undefined
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
