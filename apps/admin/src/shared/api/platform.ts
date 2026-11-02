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

// Search, filters (billing status, tier code, a promo running) and sorting;
// undefined/empty values are left off the query.
export type PlatformWorkspacesQuery = NonNullable<
  ApiTypes.ListPlatformWorkspacesData["query"]
>

export const fetchPlatformWorkspaces = async (
  p: PlatformWorkspacesQuery = {},
): Promise<PlatformWorkspacesPage> =>
  await getApiClient().request<PlatformWorkspacesPage>({
    method: "get",
    url: "/platform/workspaces",
    params: Object.fromEntries(
      Object.entries(p).filter(([, v]) => v !== undefined && v !== ""),
    ),
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

export type LockPlatformWorkspaceFeatureBody =
  ApiTypes.LockPlatformWorkspaceFeatureInputDto
export type PlatformFeatureLock = PlatformWorkspaceBillingCard["featureLocks"][number]

// Pins one of the club's app sections on or off (optionally through a date);
// the club's admin sees the switch disabled until it is unlocked.
export const lockPlatformWorkspaceFeature = async (
  workspaceId: string,
  body: LockPlatformWorkspaceFeatureBody,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<
    PlatformWorkspaceBillingCard,
    LockPlatformWorkspaceFeatureBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/feature-locks`,
    data: body,
  })

export const unlockPlatformWorkspaceFeature = async (
  workspaceId: string,
  feature: PlatformFeatureKey,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<PlatformWorkspaceBillingCard>({
    method: "delete",
    url: `/platform/workspaces/${workspaceId}/feature-locks/${feature}`,
  })

export type PlatformWorkspacePromoBody = ApiTypes.PlatformWorkspacePromoInputDto
export type PlatformWorkspacePromoPreview =
  ApiTypes.PreviewPlatformWorkspacePromoOutputOutput

// The next charge before/after a promo preset; writes nothing.
export const previewPlatformWorkspacePromo = async (
  workspaceId: string,
  body: PlatformWorkspacePromoBody,
): Promise<PlatformWorkspacePromoPreview> =>
  await getApiClient().request<
    PlatformWorkspacePromoPreview,
    PlatformWorkspacePromoBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/promos/preview`,
    data: body,
  })

export const applyPlatformWorkspacePromo = async (
  workspaceId: string,
  body: PlatformWorkspacePromoBody,
): Promise<PlatformWorkspaceBillingCard> =>
  await getApiClient().request<
    PlatformWorkspaceBillingCard,
    PlatformWorkspacePromoBody
  >({
    method: "post",
    url: `/platform/workspaces/${workspaceId}/promos`,
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

export type PlatformOnboardingRequest =
  ApiTypes.ListPlatformOnboardingRequestsOutputOutput["data"][number]
export type OnboardingRequestStatus = PlatformOnboardingRequest["status"]
export type UpdatePlatformOnboardingRequestBody =
  ApiTypes.UpdatePlatformOnboardingRequestInputDto

// Clubs' «помощь с подключением» requests, newest first; all when no status.
export const fetchPlatformOnboardingRequests = async (
  status?: OnboardingRequestStatus,
): Promise<{ data: PlatformOnboardingRequest[] }> =>
  await getApiClient().request<{ data: PlatformOnboardingRequest[] }>({
    method: "get",
    url: "/platform/onboarding-requests",
    params: status ? { status } : {},
  })

// Closes (DONE / CANCELED, with an optional note to the club) or reopens one.
export const updatePlatformOnboardingRequest = async (
  requestId: string,
  body: UpdatePlatformOnboardingRequestBody,
): Promise<PlatformOnboardingRequest> =>
  await getApiClient().request<
    PlatformOnboardingRequest,
    UpdatePlatformOnboardingRequestBody
  >({
    method: "post",
    url: `/platform/onboarding-requests/${requestId}`,
    data: body,
  })

export type PlatformDemoRequest =
  ApiTypes.ListPlatformDemoRequestsOutputOutput["data"][number]

// «Показать демо» requests from the public landing, newest first.
export const fetchPlatformDemoRequests = async (): Promise<{
  data: PlatformDemoRequest[]
}> =>
  await getApiClient().request<ApiTypes.ListPlatformDemoRequestsOutputOutput>({
    method: "get",
    url: "/platform/demo-requests",
  })

export type PlatformDemoClub = ApiTypes.GetPlatformDemoClubOutputOutput
export type PlatformDemoClubReset = ApiTypes.ResetPlatformDemoClubOutputOutput
export type PlatformDemoClubId = PlatformDemoClub["club"]

// The in-person demo clubs (docs/demo.md: ACADEMY and the dance studio «Ритм»):
// each one's accounts, the fixed code while DEMO_MODE is on, and «Сбросить
// демо» of that club only.
export const fetchPlatformDemoClub = async (club: PlatformDemoClubId): Promise<PlatformDemoClub> =>
  await getApiClient().request<PlatformDemoClub>({
    method: "get",
    url: "/platform/demo-club",
    params: { club },
  })

export const resetPlatformDemoClub = async (club: PlatformDemoClubId): Promise<PlatformDemoClubReset> =>
  await getApiClient().request<PlatformDemoClubReset>({
    method: "post",
    url: "/platform/demo-club/reset",
    params: { club },
  })
