import type { ApiTypes } from "@clubspace/api-client"

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

export type PlatformAuditPage = ApiTypes.ListPlatformAuditOutputOutput
export type PlatformAuditEvent = PlatformAuditPage["data"][number]

// The console's own actions across every club. Club-level events stay in each
// club's own journal — this is only what was done *to* clubs from /platform.
export const fetchPlatformAudit = async (p?: {
  curPage?: number
  perPage?: number
}): Promise<PlatformAuditPage> =>
  await getApiClient().request<PlatformAuditPage>({
    method: "get",
    url: "/platform/audit",
    params: {
      ...(p?.curPage ? { curPage: p.curPage } : {}),
      ...(p?.perPage ? { perPage: p.perPage } : {}),
    },
  })

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

export type UpdatePlatformWorkspaceBody = ApiTypes.UpdatePlatformWorkspaceInputDto
export type UpdatePlatformWorkspaceResult =
  ApiTypes.UpdatePlatformWorkspaceOutputOutput

export const updatePlatformWorkspace = async (
  workspaceId: string,
  body: UpdatePlatformWorkspaceBody,
): Promise<UpdatePlatformWorkspaceResult> =>
  await getApiClient().request<
    UpdatePlatformWorkspaceResult,
    UpdatePlatformWorkspaceBody
  >({
    method: "patch",
    url: `/platform/workspaces/${workspaceId}`,
    data: body,
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

export type PlatformPlansPage = ApiTypes.ListPlatformPlansOutputOutput
export type UpdatePlatformWorkspaceBillingBody =
  ApiTypes.UpdatePlatformWorkspaceBillingInputDto
export type UpdatePlatformWorkspaceBillingResult =
  ApiTypes.UpdatePlatformWorkspaceBillingOutputOutput

export const fetchPlatformPlans = async (): Promise<PlatformPlansPage> =>
  await getApiClient().request<PlatformPlansPage>({
    method: "get",
    url: "/platform/plans",
  })

// Manual billing from the console: change plan, extend a trial, record a paid
// period, suspend/resume, notes. Payment itself is collected outside ClubSpace.
export const updatePlatformWorkspaceBilling = async (
  workspaceId: string,
  body: UpdatePlatformWorkspaceBillingBody,
): Promise<UpdatePlatformWorkspaceBillingResult> =>
  await getApiClient().request<
    UpdatePlatformWorkspaceBillingResult,
    UpdatePlatformWorkspaceBillingBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/billing`,
    data: body,
  })
