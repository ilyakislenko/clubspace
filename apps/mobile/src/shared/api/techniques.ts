import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Техники»: the club sport's technique catalogue over the lessons this member
// may watch, and where each technique is taught (chapters first, then where
// it's said). Cached for offline by the screens.

export type TechniqueCatalogue = ApiTypes.ListTechniquesOutputOutput
export type TechniqueGroup = TechniqueCatalogue["categories"][number]
export type TechniqueSummary = TechniqueGroup["techniques"][number]
export type TechniqueDetail = ApiTypes.GetTechniqueOutputOutput
export type TechniqueVideo = TechniqueDetail["items"][number]
export type TechniqueMoment = TechniqueVideo["moments"][number]

export const listTechniques = async (params: { workspaceId: string }) => {
  return await getApiClient().request<TechniqueCatalogue>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/techniques`,
  })
}

export const getTechnique = async (params: { workspaceId: string; key: string }) => {
  return await getApiClient().request<TechniqueDetail>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/techniques/${encodeURIComponent(params.key)}`,
  })
}
