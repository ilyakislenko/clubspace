import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Announcement = ApiTypes.AnnouncementOutputDtoOutput
export type AnnouncementInput = ApiTypes.CreateAnnouncementInput
export type AnnouncementUpdate = ApiTypes.UpdateAnnouncementInput
export type AnnouncementList = ApiTypes.AnnouncementListOutputOutput

const base = (workspaceId: string) =>
  `/workspaces/${workspaceId}/announcements`

export const listAnnouncements = async (p: {
  workspaceId: string
  curPage?: number
  perPage?: number
}): Promise<AnnouncementList> =>
  await getApiClient().request<AnnouncementList>({
    method: "get",
    url: base(p.workspaceId),
    params: { curPage: p.curPage, perPage: p.perPage },
  })

export const createAnnouncement = async (p: {
  workspaceId: string
  data: AnnouncementInput
}): Promise<Announcement> =>
  await getApiClient().request<Announcement, AnnouncementInput>({
    method: "post",
    url: base(p.workspaceId),
    data: p.data,
  })

export const updateAnnouncement = async (p: {
  workspaceId: string
  announcementId: string
  data: AnnouncementUpdate
}): Promise<Announcement> =>
  await getApiClient().request<Announcement, AnnouncementUpdate>({
    method: "patch",
    url: `${base(p.workspaceId)}/${p.announcementId}`,
    data: p.data,
  })

export const deleteAnnouncement = async (p: {
  workspaceId: string
  announcementId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${base(p.workspaceId)}/${p.announcementId}`,
  })
