import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClubPublicProfile = ApiTypes.ClubPublicProfileOutputDtoOutput
export type ClubPublicProfileInput = ApiTypes.UpdateClubPublicProfileInput
export type ClubLogoUploadInput = ApiTypes.CreateClubLogoUploadInput
export type ClubLogoUpload = ApiTypes.CreateClubLogoUploadOutputDtoOutput

export const getClubPublicProfile = async (params: {
  workspaceId: string
}): Promise<ClubPublicProfile> => {
  return await getApiClient().request<ClubPublicProfile>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/public-profile`,
  })
}

export const updateClubPublicProfile = async (params: {
  workspaceId: string
  data: ClubPublicProfileInput
}): Promise<ClubPublicProfile> => {
  return await getApiClient().request<ClubPublicProfile, ClubPublicProfileInput>(
    {
      method: "put",
      url: `/workspaces/${params.workspaceId}/public-profile`,
      data: params.data,
    },
  )
}

export const createClubLogoUpload = async (params: {
  workspaceId: string
  data: ClubLogoUploadInput
}): Promise<ClubLogoUpload> => {
  return await getApiClient().request<ClubLogoUpload, ClubLogoUploadInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/public-profile/logo-upload`,
    data: params.data,
  })
}
