import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClubAbout = ApiTypes.ClubAboutOutputDtoOutput
export type ClubAboutInput = ApiTypes.UpdateClubAboutInput

export const getClubAbout = async (params: {
  workspaceId: string
}): Promise<ClubAbout> => {
  return await getApiClient().request<ClubAbout>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/about`,
  })
}

export const updateClubAbout = async (params: {
  workspaceId: string
  data: ClubAboutInput
}): Promise<ClubAbout> => {
  return await getApiClient().request<ClubAbout, ClubAboutInput>({
    method: "put",
    url: `/workspaces/${params.workspaceId}/about`,
    data: params.data,
  })
}
