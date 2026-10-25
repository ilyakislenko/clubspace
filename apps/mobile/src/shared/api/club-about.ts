import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClubAbout = ApiTypes.ClubAboutOutputDtoOutput

export const getClubAbout = async (params: {
  workspaceId: string
}): Promise<ClubAbout> =>
  await getApiClient().request<ClubAbout>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/about`,
  })
