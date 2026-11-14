import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

// The current user's own account. Works for any authenticated user —
// including a workspace owner, who has no WorkspaceMember row — so it's the
// reliable source for the account menu and «Мой профиль».
export const fetchMe = async (): Promise<Me> => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}

// The user's own name, any role (the e-mail is the login and can't be changed
// from the admin app).
export const updateMe = async (
  body: ApiTypes.UpdateMeInput,
): Promise<Me> => {
  return await getApiClient().request<Me>({
    method: "patch",
    url: "/me",
    data: body,
  })
}
