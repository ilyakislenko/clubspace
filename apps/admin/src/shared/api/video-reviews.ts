import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// A member's clip sent for review: staff watch it, comment on moments and
// mark it answered or closed. Drawing on frames and editing comments stay in
// the app.
export type VideoReview = ApiTypes.GetVideoReviewOutputOutput
export type VideoReviewComment = VideoReview["comments"][number]
export type VideoReviewPlayback = ApiTypes.GetVideoReviewPlaybackOutputOutput
export type AddVideoReviewCommentInput = ApiTypes.AddVideoReviewCommentInput
export type SetVideoReviewStatusInput = ApiTypes.SetVideoReviewStatusInput
export type VideoReviewSummary = ApiTypes.SetVideoReviewStatusOutputOutput

const base = (workspaceId: string, requestId: string) =>
  `/workspaces/${workspaceId}/video-reviews/${requestId}`

// The review with every comment, oldest moment first.
export const getVideoReview = async (params: {
  workspaceId: string
  requestId: string
}): Promise<VideoReview> =>
  await getApiClient().request<VideoReview>({
    method: "get",
    url: base(params.workspaceId, params.requestId),
  })

// The clip's HLS manifest (served by the API) once it is processed.
export const getVideoReviewPlayback = async (params: {
  workspaceId: string
  requestId: string
}): Promise<VideoReviewPlayback> =>
  await getApiClient().request<VideoReviewPlayback>({
    method: "get",
    url: `${base(params.workspaceId, params.requestId)}/playback`,
  })

// Returns the review with its comments.
export const addVideoReviewComment = async (params: {
  workspaceId: string
  requestId: string
  data: AddVideoReviewCommentInput
}): Promise<VideoReview> =>
  await getApiClient().request<VideoReview, AddVideoReviewCommentInput>({
    method: "post",
    url: `${base(params.workspaceId, params.requestId)}/comments`,
    data: params.data,
  })

// The viewer's own comment only (the server's rule). Returns the review.
export const deleteVideoReviewComment = async (params: {
  workspaceId: string
  requestId: string
  commentId: string
}): Promise<VideoReview> =>
  await getApiClient().request<VideoReview>({
    method: "delete",
    url: `${base(params.workspaceId, params.requestId)}/comments/${params.commentId}`,
  })

// «answered» notifies the member; «closed» does not; staff may reopen.
export const setVideoReviewStatus = async (params: {
  workspaceId: string
  requestId: string
  data: SetVideoReviewStatusInput
}): Promise<VideoReviewSummary> =>
  await getApiClient().request<VideoReviewSummary, SetVideoReviewStatusInput>({
    method: "put",
    url: `${base(params.workspaceId, params.requestId)}/status`,
    data: params.data,
  })
