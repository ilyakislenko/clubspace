import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

export const fetchMe = async () => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}
