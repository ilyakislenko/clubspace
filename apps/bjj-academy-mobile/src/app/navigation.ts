export type RootStackParamList = {
  SignIn: undefined
  Courses: undefined
  CourseDetail: { courseId: string; title?: string }
  Video: { videoId: string; courseId?: string; title?: string }
  Profile: undefined
  OfflineLibrary: undefined
  Settings: undefined
  ContinueWatching: undefined
  Favorites: undefined
}
