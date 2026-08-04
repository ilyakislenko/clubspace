import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

// The platform console (`/platform/*`) — the tier above the per-workspace
// admin. Every route here is refused with 403 unless the signed-in account has
// isSuperAdmin, so callers should gate the UI on `fetchMe().isSuperAdmin`
// rather than letting the request fail.
export type PlatformOverview = ApiTypes.GetPlatformOverviewOutputOutput
export type PlatformWorkspacesPage = ApiTypes.ListPlatformWorkspacesOutputOutput
export type PlatformWorkspace = PlatformWorkspacesPage["data"][number]
export type CreatePlatformWorkspaceBody = ApiTypes.CreatePlatformWorkspaceInputDto
export type CreatePlatformWorkspaceResult =
  ApiTypes.CreatePlatformWorkspaceOutputOutput

export const fetchPlatformOverview = async (): Promise<PlatformOverview> =>
  await getApiClient().request<PlatformOverview>({
    method: "get",
    url: "/platform/overview",
  })

export const fetchPlatformWorkspaces = async (p?: {
  curPage?: number
  perPage?: number
  search?: string
}): Promise<PlatformWorkspacesPage> =>
  await getApiClient().request<PlatformWorkspacesPage>({
    method: "get",
    url: "/platform/workspaces",
    params: {
      ...(p?.curPage ? { curPage: p.curPage } : {}),
      ...(p?.perPage ? { perPage: p.perPage } : {}),
      ...(p?.search ? { search: p.search } : {}),
    },
  })

export const createPlatformWorkspace = async (
  body: CreatePlatformWorkspaceBody,
): Promise<CreatePlatformWorkspaceResult> =>
  await getApiClient().request<
    CreatePlatformWorkspaceResult,
    CreatePlatformWorkspaceBody
  >({
    method: "post",
    url: "/platform/workspaces",
    data: body,
  })
