import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Спросить ИИ по видео клуба»: a short answer from the club's own video
// transcripts with the moments it comes from. Online only.

export type VideoAnswersState = ApiTypes.ClubVideoAnswersStateOutputOutput
export type VideoAnswer = ApiTypes.AskClubVideosOutputOutput
export type VideoAnswerCitation = VideoAnswer["citations"][number]

// The server gives the model 30 s; the default 15 s client timeout would cut it.
const ASK_TIMEOUT_MS = 40_000

export const getVideoAnswersState = async (params: { workspaceId: string }) =>
  await getApiClient().request<VideoAnswersState>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/video-answers/state`,
  })

export const acceptVideoAnswersNotice = async (params: { workspaceId: string; version: string }) =>
  await getApiClient().request<VideoAnswersState, ApiTypes.AcceptClubVideoAnswersNoticeInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/video-answers/notice`,
    data: { version: params.version },
  })

export const askClubVideos = async (params: { workspaceId: string; question: string }) =>
  await getApiClient().request<VideoAnswer, ApiTypes.AskClubVideosInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/video-answers`,
    data: { question: params.question },
    timeout: ASK_TIMEOUT_MS,
  })
