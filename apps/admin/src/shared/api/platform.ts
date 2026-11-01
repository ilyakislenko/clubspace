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

export type PlatformWorkspaceBillingCard =
  ApiTypes.PlatformWorkspaceBillingOutputOutput
export type UpdatePlatformWorkspaceBillingBody =
  ApiTypes.UpdatePlatformWorkspaceBillingInputDto
export type UpdatePlatformWorkspaceModuleBody =
  ApiTypes.UpdatePlatformWorkspaceModuleInputDto
export type SetPlatformWorkspaceFeatureBody =
  ApiTypes.SetPlatformWorkspaceFeatureInputDto
export type PlatformFeatureKey = SetPlatformWorkspaceFeatureBody["feature"]

// One club's billing card in the console: what it pays, its modules and app
// sections, the operator's overrides and the console's history for the club.
// Every write below answers with the refreshed card.
export const fetchPlatformWorkspaceBilling = async (
  workspaceId: string,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<PlatformWorkspaceBillingCard>({
    method: "get",
    url: `/platform/workspaces/${workspaceId}/billing`,
  })

// Manual billing from the console: extend a trial, record a paid period (an
// invoice paid outside the card checkout), suspend/resume, notes, price
// overrides.
export const updatePlatformWorkspaceBilling = async (
  workspaceId: string,
  body: UpdatePlatformWorkspaceBillingBody,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<
    PlatformWorkspaceBillingCard,
    UpdatePlatformWorkspaceBillingBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/billing`,
    data: body,
  })

export const updatePlatformWorkspaceModule = async (
  workspaceId: string,
  body: UpdatePlatformWorkspaceModuleBody,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<
    PlatformWorkspaceBillingCard,
    UpdatePlatformWorkspaceModuleBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/modules`,
    data: body,
  })

// Forces one of the club's app-section switches (enabling «videos» is refused
// without the VIDEO module).
export const setPlatformWorkspaceFeature = async (
  workspaceId: string,
  body: SetPlatformWorkspaceFeatureBody,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<
    PlatformWorkspaceBillingCard,
    SetPlatformWorkspaceFeatureBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/features`,
    data: body,
  })

export type PlatformWorkspacePayment =
  ApiTypes.ListPlatformWorkspacePaymentsOutputOutput["data"][number]
export type RetryPlatformWorkspacePaymentResult =
  ApiTypes.RetryPlatformWorkspacePaymentOutputOutput
export type RefundPlatformWorkspacePaymentBody =
  ApiTypes.RefundPlatformWorkspacePaymentInputDto
export type SetPlatformWorkspaceAutopayBody = ApiTypes.SetPlatformWorkspaceAutopayInputDto

// The club's card payments to ClubSpace (YooKassa), newest first.
export const listPlatformWorkspacePayments = async (
  workspaceId: string,
): Promise<{ data: PlatformWorkspacePayment[] }> =>
  await getApiClient().request<{ data: PlatformWorkspacePayment[] }>({
    method: "get",
    url: `/platform/workspaces/${workspaceId}/payments`,
  })

// «Повторить списание сейчас»: charges the saved card for the due renewal
// without waiting for the next autopay attempt.
export const retryPlatformWorkspacePayment = async (
  workspaceId: string,
): Promise<RetryPlatformWorkspacePaymentResult> =>
  await getApiClient().request<RetryPlatformWorkspacePaymentResult>({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/payments/retry`,
  })

// Full (amount omitted) or partial refund through YooKassa. The paid period
// stays as is.
export const refundPlatformWorkspacePayment = async (
  workspaceId: string,
  paymentId: string,
  body: RefundPlatformWorkspacePaymentBody,
): Promise<PlatformWorkspacePayment> =>
  await getApiClient().request<
    PlatformWorkspacePayment,
    RefundPlatformWorkspacePaymentBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/payments/${paymentId}/refund`,
    data: body,
  })

// Switches automatic renewal from the saved card for the club.
export const setPlatformWorkspaceAutopay = async (
  workspaceId: string,
  body: SetPlatformWorkspaceAutopayBody,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<
    PlatformWorkspaceBillingCard,
    SetPlatformWorkspaceAutopayBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/autopay`,
    data: body,
  })
