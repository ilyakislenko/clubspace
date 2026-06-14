import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type CourseSummary = ApiTypes.ListPlaylistsOutputOutput["data"][number]

export type CourseDetail = ApiTypes.GetPlaylistOutputOutput

export type CourseVideo = CourseDetail["videos"][number]

export const listCourses = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
  q?: string
}) => {
  return await getApiClient().request<ApiTypes.ListPlaylistsOutputOutput>({
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
