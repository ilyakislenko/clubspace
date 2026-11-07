import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Повторение»: spaced repetition of the member's bookmarks and A–B segments.
// The server keeps each card's schedule; the device grades (offline too — see
// features/reviews/review-store) and the due list says what's next.

export type MyReviews = ApiTypes.ListMyReviewsOutputOutput
export type ReviewCard = MyReviews["items"][number]
export type ReviewGrade = ApiTypes.ReviewMyBookmarkInput["grade"]
export type ReviewSchedule = ApiTypes.ReviewMyBookmarkOutputOutput

// Cards due now (oldest-due first, capped) plus counts of what comes later.
export const listMyReviews = async (params: { workspaceId: string }) => {
  return await getApiClient().request<MyReviews>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/reviews`,
  })
}

export const reviewMyBookmarkUrl = (videoId: string, bookmarkId: string) =>
  `/videos/${videoId}/my-bookmarks/${bookmarkId}/review`

// `reviewedAt` is the device clock of the grade; a grade not newer than the
// card's last one is ignored, so replaying it is safe.
export const reviewMyBookmark = async (params: {
  videoId: string
  bookmarkId: string
  data: ApiTypes.ReviewMyBookmarkInput
}) => {
  return await getApiClient().request<
    ReviewSchedule,
    ApiTypes.ReviewMyBookmarkInput
  >({
    method: "post",
    url: reviewMyBookmarkUrl(params.videoId, params.bookmarkId),
    data: params.data,
  })
}
