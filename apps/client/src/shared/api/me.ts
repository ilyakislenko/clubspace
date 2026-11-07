import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

export const fetchMe = async () => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}

// Deletes the account with a fresh code from POST /send-auth-code for the
// account's own address.
export const deleteAccount = async (code: string) => {
  return await getApiClient().request<
    ApiTypes.DeleteAccountOutputOutput,
    ApiTypes.DeleteAccountInput
  >({
    method: "post",
    url: "/me/delete-account",
    data: { code },
  })
}
