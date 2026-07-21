import { createNavigationContainerRef } from "@react-navigation/native"

export type RootStackParamList = {
  SignIn: undefined
  Courses: undefined
  CourseDetail: { courseId: string; title?: string }
  Video: { videoId: string; courseId?: string; title?: string }
  Profile: undefined
  Notifications: undefined
  OfflineLibrary: undefined
  Settings: undefined
  ContinueWatching: undefined
  Favorites: undefined
  MyGroups: undefined
  Gyms: undefined
  ClubSchedule: undefined
  Events: undefined
  SessionAttendance: {
    slotId: string
    sessionDate: string
    groupName?: string
  }
  MyAttendance: undefined
  CheckIn: undefined
  MySubscription: undefined
  MyRanks: undefined
  Achievements: undefined
  Journal: undefined
  Announcements: undefined
  Leaderboard: undefined
}

// Ref so code outside the React tree (e.g. a push-notification tap handler)
// can drive navigation.
export const navigationRef = createNavigationContainerRef<RootStackParamList>()
