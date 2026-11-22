import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead, invalidateReads } from "./read-cache"

export type Me = ApiTypes.GetMeOutputOutput

// The account changes only through updateMe below (or a new session), so one
// answer serves the sidebar and every page for a minute.
const ME_TTL_MS = 60_000

// The current user's own account. Works for any authenticated user —
// including a workspace owner, who has no WorkspaceMember row — so it's the
// reliable source for the account menu and «Мой профиль».
export const fetchMe = (): Promise<Me> =>
  cachedRead(
    "me",
    () => getApiClient().request<Me>({ method: "get", url: "/me" }),
    ME_TTL_MS,
  )

// The user's own name, any role (the e-mail is the login and can't be changed
// from the admin app).
export const updateMe = async (
  body: ApiTypes.UpdateMeInput,
): Promise<Me> => {
  const updated = await getApiClient().request<Me>({
    method: "patch",
    url: "/me",
    data: body,
  })
  invalidateReads("me")
  return updated
}
