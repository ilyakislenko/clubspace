import { getApiClient } from "./client"

export type CourseSummary = {
  id: string
  workspaceId: string
  title: string
  slug: string
  description?: string | null
  thumbnailUrl?: string | null
  status?: string | null
  level?: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type CourseVideo = {
  id: string
  title: string
  description?: string | null
  status: string
  duration?: number | null
  thumbnailUrl?: string | null
  order: number
  chapterTitle?: string | null
}

export type CourseDetail = CourseSummary & {
  videos: CourseVideo[]
}

export const listCourses = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
  q?: string
}) => {
  return await getApiClient().request<{
    data: CourseSummary[]
    total: number
    curPage: number
    perPage: number
  }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/playlists`,
    params: {
      curPage: params.curPage,
      perPage: params.perPage,
      q: params.q,
    },
  })
}

export const getCourse = async (params: {
  workspaceId: string
  courseId: string
}) => {
  return await getApiClient().request<CourseDetail>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/playlists/${params.courseId}`,
  })
}
