import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Сообщения клуба» (docs/design/2026-11-26-broadcast-and-direct-messages.md).
// Member routes answer for the profile acted for (X-Act-As: a child's rows).

export type MyClubMessage = ApiTypes.MyClubMessageOutputOutput
export type MyClubMessagesPage = ApiTypes.ListMyClubMessagesOutputOutput
export type ClubMessagePreview = ApiTypes.PreviewClubMessageOutputOutput
export type ClubMessage = ApiTypes.ClubMessageOutputOutput
export type PreviewClubMessageInput = ApiTypes.PreviewClubMessageInput
export type SendClubMessageInput = ApiTypes.SendClubMessageInput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/messages`

export const listMyClubMessages = async (p: {
  workspaceId: string
  perPage?: number
}) =>
  await getApiClient().request<MyClubMessagesPage>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/me/messages`,
    params: { perPage: p.perPage ?? 50 },
  })

export const getMyClubMessage = async (p: {
  workspaceId: string
  messageId: string
}) =>
  await getApiClient().request<MyClubMessage>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/me/messages/${p.messageId}`,
  })

// Idempotent: the first open stamps `readAt` («открыли»), later ones keep it.
export const markClubMessageRead = async (p: {
  workspaceId: string
  messageId: string
}) =>
  await getApiClient().request<MyClubMessage>({
    method: "post",
    url: `/workspaces/${p.workspaceId}/me/messages/${p.messageId}/read`,
  })

// Staff: who would get it now, through which channel, and when it leaves.
export const previewClubMessage = async (p: {
  workspaceId: string
  data: PreviewClubMessageInput
}) =>
  await getApiClient().request<ClubMessagePreview, PreviewClubMessageInput>({
    method: "post",
    url: `${base(p.workspaceId)}/preview`,
    data: p.data,
  })

export const sendClubMessage = async (p: {
  workspaceId: string
  data: SendClubMessageInput
}) =>
  await getApiClient().request<ClubMessage, SendClubMessageInput>({
    method: "post",
    url: base(p.workspaceId),
    data: p.data,
  })
