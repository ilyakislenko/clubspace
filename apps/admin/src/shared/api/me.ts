import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

// The current user's own account. Works for any authenticated user —
// including a workspace owner, who has no WorkspaceMember row — so it's the
// reliable source for the admin's own name on the "Мой профиль" card.
export const fetchMe = async (): Promise<Me> => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}
