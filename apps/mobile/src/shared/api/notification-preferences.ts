import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type NotificationPreferences =
  ApiTypes.GetNotificationPreferencesOutputOutput

export const getNotificationPreferences =
  async (): Promise<NotificationPreferences> =>
    await getApiClient().request<NotificationPreferences>({
      method: "get",
      url: "/me/notification-preferences",
    })

export const updateNotificationPreferences = async (
  patch: ApiTypes.UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences> =>
  await getApiClient().request<
    NotificationPreferences,
    ApiTypes.UpdateNotificationPreferencesInput
  >({
    method: "put",
    url: "/me/notification-preferences",
    data: patch,
  })
