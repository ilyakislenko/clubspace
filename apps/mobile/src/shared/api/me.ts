import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Me = ApiTypes.GetMeOutputOutput

export const fetchMe = async () => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}

export type UpdateMeInput = ApiTypes.UpdateMeInput

// The member edits their own name. A blank field clears it (stored as null).
export const updateMe = async (data: UpdateMeInput): Promise<Me> => {
  return await getApiClient().request<Me, UpdateMeInput>({
    method: "patch",
    url: "/me",
    data,
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

export type MyDataExport = ApiTypes.ExportMyDataOutputOutput

// A copy of everything the platform holds about the current user (152-ФЗ
// ст. 14). Rate-limited server-side: a 429 carries a Russian message.
export const exportMyData = async (): Promise<MyDataExport> => {
  return await getApiClient().request<MyDataExport>({
    method: "get",
    url: "/me/export",
  })
}
