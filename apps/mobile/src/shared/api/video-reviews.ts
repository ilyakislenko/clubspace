import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Разбор видео»: a member sends a clip of themselves to the club's coaches;
// a coach answers with comments pinned to moments (optionally a drawing).
// Member clips are never club content: their own endpoints, their own
// playback route. Online only.

export type VideoReviewSummary =
  ApiTypes.ListMyVideoReviewsOutputOutput["items"][number]
export type VideoReview = ApiTypes.GetVideoReviewOutputOutput
export type VideoReviewComment = VideoReview["comments"][number]
export type VideoReviewStatus = VideoReviewSummary["status"]
export type ReviewDrawing = NonNullable<VideoReviewComment["drawing"]>
export type VideoReviewCommentInput = ApiTypes.AddVideoReviewCommentInput

const mine = (workspaceId: string) => `/workspaces/${workspaceId}/me/video-reviews`
const club = (workspaceId: string) => `/workspaces/${workspaceId}/video-reviews`

// ---- the member ----

export const listMyVideoReviews = async (params: { workspaceId: string }) => {
  return await getApiClient().request<ApiTypes.ListMyVideoReviewsOutputOutput>({
    method: "get",
    url: mine(params.workspaceId),
  })
}

// Creates the request and signs the upload: PUT the file to `upload.url`,
// then `completeMyVideoReviewUpload`.
export const createMyVideoReview = async (params: {
  workspaceId: string
  data: ApiTypes.CreateMyVideoReviewInput
}) => {
  return await getApiClient().request<
    ApiTypes.CreateMyVideoReviewOutputOutput,
    ApiTypes.CreateMyVideoReviewInput
  >({ method: "post", url: mine(params.workspaceId), data: params.data })
}

export const completeMyVideoReviewUpload = async (params: {
  workspaceId: string
  requestId: string
}) => {
  return await getApiClient().request<ApiTypes.CompleteMyVideoReviewUploadOutputOutput>({
    method: "post",
    url: `${mine(params.workspaceId)}/${params.requestId}/complete`,
  })
}

// Removes the request, its comments and the clip with its files.
export const deleteMyVideoReview = async (params: {
  workspaceId: string
  requestId: string
}) => {
  return await getApiClient().request<ApiTypes.DeleteMyVideoReviewOutputOutput>({
    method: "delete",
    url: `${mine(params.workspaceId)}/${params.requestId}`,
  })
}

// ---- the member or the club's staff ----

export const getVideoReview = async (params: { workspaceId: string; requestId: string }) => {
  return await getApiClient().request<VideoReview>({
    method: "get",
    url: `${club(params.workspaceId)}/${params.requestId}`,
  })
}

// A signed HLS link (hours long) to the clip, once it's transcoded.
export const getVideoReviewPlayback = async (params: {
  workspaceId: string
  requestId: string
}) => {
  return await getApiClient().request<ApiTypes.GetVideoReviewPlaybackOutputOutput>({
    method: "get",
    url: `${club(params.workspaceId)}/${params.requestId}/playback`,
  })
}

// Staff: answered / closed / open; the member: closed or open again.
export const setVideoReviewStatus = async (params: {
  workspaceId: string
  requestId: string
  status: ApiTypes.SetVideoReviewStatusInput["status"]
}) => {
  return await getApiClient().request<
    ApiTypes.SetVideoReviewStatusOutputOutput,
    ApiTypes.SetVideoReviewStatusInput
  >({
    method: "put",
    url: `${club(params.workspaceId)}/${params.requestId}/status`,
    data: { status: params.status },
  })
}

// ---- the club's staff ----

// The club's requests, waiting ones first.
export const listClubVideoReviews = async (params: { workspaceId: string }) => {
  return await getApiClient().request<ApiTypes.ListClubVideoReviewsOutputOutput>({
    method: "get",
    url: club(params.workspaceId),
  })
}

export const addVideoReviewComment = async (params: {
  workspaceId: string
  requestId: string
  data: VideoReviewCommentInput
}) => {
  return await getApiClient().request<VideoReview, VideoReviewCommentInput>({
    method: "post",
    url: `${club(params.workspaceId)}/${params.requestId}/comments`,
    data: params.data,
  })
}

export const updateVideoReviewComment = async (params: {
  workspaceId: string
  requestId: string
  commentId: string
  data: ApiTypes.UpdateVideoReviewCommentInput
}) => {
  return await getApiClient().request<VideoReview, ApiTypes.UpdateVideoReviewCommentInput>({
    method: "patch",
    url: `${club(params.workspaceId)}/${params.requestId}/comments/${params.commentId}`,
    data: params.data,
  })
}

export const deleteVideoReviewComment = async (params: {
  workspaceId: string
  requestId: string
  commentId: string
}) => {
  return await getApiClient().request<VideoReview>({
    method: "delete",
    url: `${club(params.workspaceId)}/${params.requestId}/comments/${params.commentId}`,
  })
}
