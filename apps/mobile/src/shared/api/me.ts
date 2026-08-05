import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

export const fetchMe = async () => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}

// Permanently deletes the current user's account (App Store 5.1.1(v)). The
// server rejects this for club owners/coaches; the caller signs out locally
// on success.
export const deleteAccount = async () => {
  return await getApiClient().request<ApiTypes.DeleteAccountOutputOutput>({
    method: "delete",
    url: "/me",
  })
}
