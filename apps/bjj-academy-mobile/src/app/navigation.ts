export type RootStackParamList = {
  SignIn: undefined
  Courses: undefined
  CourseDetail: { courseId: string; title?: string }
  Video: { videoId: string; courseId?: string; title?: string }
}
