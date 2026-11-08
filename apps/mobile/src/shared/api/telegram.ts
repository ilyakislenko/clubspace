import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Notifications in the member-facing Telegram bot (server: features/telegram-link).
export type TelegramStatus = ApiTypes.TelegramStatusOutputOutput
export type TelegramLink = ApiTypes.TelegramLinkOutputOutput

export const getTelegramStatus = async (): Promise<TelegramStatus> =>
  await getApiClient().request<TelegramStatus>({
    method: "get",
    url: "/me/telegram",
  })

// A one-time t.me deep link (15 minutes); opening it and pressing «Start»
// links the chat.
export const createTelegramLink = async (): Promise<TelegramLink> =>
  await getApiClient().request<TelegramLink>({
    method: "post",
    url: "/me/telegram/link",
  })

export const setTelegramEnabled = async (
  enabled: boolean,
): Promise<TelegramStatus> =>
  await getApiClient().request<TelegramStatus, ApiTypes.UpdateMyTelegramInput>({
    method: "patch",
    url: "/me/telegram",
    data: { enabled },
  })

export const unlinkTelegram = async (): Promise<TelegramStatus> =>
  await getApiClient().request<TelegramStatus>({
    method: "delete",
    url: "/me/telegram",
  })
