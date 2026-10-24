import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

export const fetchMe = async () => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}

export const deleteAccount = async () => {
  return await getApiClient().request<ApiTypes.DeleteAccountOutputOutput>({
    method: "delete",
    url: "/me",
  })
}
