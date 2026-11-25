import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Ученики → Сообщения»: messages from the club to a segment of its students
// or to one student. The server resolves the segment at send time, scopes
// every list to what the viewer may see and refuses segments above the role.
export type ClubMessage = ApiTypes.ClubMessageOutputOutput
export type ClubMessageSegment = ClubMessage["segment"]
export type ClubMessagesPage = ApiTypes.ListClubMessagesOutputOutput
export type ClubMessageRecipientsPage = ApiTypes.ListClubMessageRecipientsOutputOutput
export type ClubMessageRecipient = ClubMessageRecipientsPage["data"][number]
export type PushSkip = NonNullable<ClubMessageRecipient["pushSkip"]>
export type ClubMessagePreviewInput = ApiTypes.PreviewClubMessageInput
export type ClubMessagePreview = ApiTypes.PreviewClubMessageOutputOutput
export type SendClubMessageInput = ApiTypes.SendClubMessageInput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/messages`

export const listClubMessages = async (params: {
  workspaceId: string
  // Only messages this student received (the member card's block).
  userId?: string
  curPage?: number
  perPage?: number
}): Promise<ClubMessagesPage> =>
  await getApiClient().request<ClubMessagesPage>({
    method: "get",
    url: base(params.workspaceId),
    params: { userId: params.userId, curPage: params.curPage, perPage: params.perPage },
  })

export const getClubMessage = async (params: {
  workspaceId: string
  messageId: string
}): Promise<ClubMessage> =>
  await getApiClient().request<ClubMessage>({
    method: "get",
    url: `${base(params.workspaceId)}/${params.messageId}`,
  })

export const listClubMessageRecipients = async (params: {
  workspaceId: string
  messageId: string
  curPage?: number
  perPage?: number
}): Promise<ClubMessageRecipientsPage> =>
  await getApiClient().request<ClubMessageRecipientsPage>({
    method: "get",
    url: `${base(params.workspaceId)}/${params.messageId}/recipients`,
    params: { curPage: params.curPage, perPage: params.perPage },
  })

// Who would get it now, with push, opted out, deferred by quiet hours, and
// the sender's limits left today. Nothing is written.
export const previewClubMessage = async (params: {
  workspaceId: string
  data: ClubMessagePreviewInput
}): Promise<ClubMessagePreview> =>
  await getApiClient().request<ClubMessagePreview, ClubMessagePreviewInput>({
    method: "post",
    url: `${base(params.workspaceId)}/preview`,
    data: params.data,
  })

// Sends now (the answer carries the counters) or schedules it (quiet hours,
// «Отправить позже»).
export const sendClubMessage = async (params: {
  workspaceId: string
  data: SendClubMessageInput
}): Promise<ClubMessage> =>
  await getApiClient().request<ClubMessage, SendClubMessageInput>({
    method: "post",
    url: base(params.workspaceId),
    data: params.data,
  })

export const cancelClubMessage = async (params: {
  workspaceId: string
  messageId: string
}): Promise<ClubMessage> =>
  await getApiClient().request<ClubMessage>({
    method: "post",
    url: `${base(params.workspaceId)}/${params.messageId}/cancel`,
  })
