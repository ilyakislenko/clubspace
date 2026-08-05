import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type NotificationsPage = ApiTypes.GetMyNotificationsOutputOutput
export type NotificationItem = NotificationsPage["data"][number]

export const listNotifications = async (params?: {
  curPage?: number
  perPage?: number
}) => {
  const search = new URLSearchParams()
  if (params?.curPage) search.set("curPage", String(params.curPage))
  if (params?.perPage) search.set("perPage", String(params.perPage))
  const qs = search.toString()
  return await getApiClient().request<NotificationsPage>({
    method: "get",
    url: `/me/notifications${qs ? `?${qs}` : ""}`,
  })
}

// Mark specific notifications seen, or all unseen ones when `ids` is omitted.
export const markNotificationsSeen = async (ids?: string[]) => {
  return await getApiClient().request<
    ApiTypes.MarkNotificationsSeenOutputOutput,
    ApiTypes.MarkNotificationsSeenInput
  >({
    method: "post",
    url: "/me/notifications/seen",
    data: ids && ids.length > 0 ? { ids } : {},
  })
}
