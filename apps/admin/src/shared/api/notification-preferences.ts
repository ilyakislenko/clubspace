import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type NotificationPreferences =
  ApiTypes.GetNotificationPreferencesOutputOutput
export type NotificationPreferencesUpdate =
  ApiTypes.UpdateNotificationPreferencesInput

export const getNotificationPreferences =
  async (): Promise<NotificationPreferences> =>
    await getApiClient().request<NotificationPreferences>({
      method: "get",
      url: "/me/notification-preferences",
    })

export const updateNotificationPreferences = async (
  patch: NotificationPreferencesUpdate,
): Promise<NotificationPreferences> =>
  await getApiClient().request<
    NotificationPreferences,
    NotificationPreferencesUpdate
  >({
    method: "put",
    url: "/me/notification-preferences",
    data: patch,
  })
