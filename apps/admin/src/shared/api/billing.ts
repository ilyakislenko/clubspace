import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Platform billing of the club (what the club pays ClubSpace) — not the club's
// own abonements, which live in subscriptions.ts.
export type WorkspaceBillingPage = ApiTypes.GetWorkspaceBillingOutputOutput
export type WorkspaceBilling = WorkspaceBillingPage["billing"]
export type BillingTier = WorkspaceBillingPage["tiers"][number]
export type BillingModule = WorkspaceBilling["modules"][number]
export type BillingQuote = WorkspaceBilling["quote"]
export type WorkspaceOnboarding = ApiTypes.GetWorkspaceOnboardingOutputOutput
export type SelfServeConfig = ApiTypes.GetSelfServeConfigOutputOutput
export type CreateSelfServeWorkspaceBody = ApiTypes.CreateSelfServeWorkspaceInputDto
export type CreateSelfServeWorkspaceResult =
  ApiTypes.CreateSelfServeWorkspaceOutputOutput
export type BillingAutopay = WorkspaceBilling["autopay"]
export type BillingPayment =
  ApiTypes.ListWorkspaceBillingPaymentsOutputOutput["data"][number]
export type BillingModuleCode = ApiTypes.SetWorkspaceBillingModuleInputDto["module"]
export type StartBillingCheckoutBody = ApiTypes.StartWorkspaceBillingCheckoutInputDto
export type StartBillingCheckoutResult =
  ApiTypes.StartWorkspaceBillingCheckoutOutputOutput
export type SetBillingModuleBody = ApiTypes.SetWorkspaceBillingModuleInputDto
export type SetBillingModuleResult = ApiTypes.SetWorkspaceBillingModuleOutputOutput
export type BillingModuleOutcome = SetBillingModuleResult["outcome"]
export type SetBillingPeriodBody = ApiTypes.SetWorkspaceBillingPeriodInputDto
export type SetBillingPeriodResult = ApiTypes.SetWorkspaceBillingPeriodOutputOutput
export type RemoveBillingCardResult = ApiTypes.RemoveWorkspaceBillingCardOutputOutput
export type BillingTrial = WorkspaceBilling["trial"]
export type StartBillingCardCheckResult =
  ApiTypes.StartWorkspaceBillingCardCheckOutputOutput

export const getWorkspaceBilling = async (p: { workspaceId: string }) =>
  getApiClient().request<WorkspaceBillingPage>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/billing`,
  })

// Card payment of the next period (1 or 12 months — also how renewals are
// charged from then on). The browser goes on to `confirmationUrl` (YooKassa),
// which returns to /workspace/:id/billing?payment=<paymentId>.
export const startBillingCheckout = async (p: {
  workspaceId: string
  periodMonths: 1 | 12
}) =>
  getApiClient().request<StartBillingCheckoutResult, StartBillingCheckoutBody>({
    method: "post",
    url: `/workspaces/${p.workspaceId}/billing/checkout`,
    data: { periodMonths: p.periodMonths },
  })

// «Пробный период с картой»: a small check charge that saves the card and is
// refunded at once; the first paid period is then charged from it when the
// trial ends. Same YooKassa round trip as the checkout.
export const startBillingCardCheck = async (p: { workspaceId: string }) =>
  getApiClient().request<StartBillingCardCheckResult>({
    method: "post",
    url: `/workspaces/${p.workspaceId}/billing/card`,
  })

// One payment; the server re-reads a pending one from YooKassa.
export const getBillingPayment = async (p: { workspaceId: string; paymentId: string }) =>
  getApiClient().request<BillingPayment>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/billing/payments/${p.paymentId}`,
  })

export const listBillingPayments = async (p: { workspaceId: string }) =>
  getApiClient().request<{ data: BillingPayment[] }>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/billing/payments`,
  })

// Connect (true) or disconnect (false) a paid module.
export const setBillingModule = async (p: {
  workspaceId: string
  module: BillingModuleCode
  enabled: boolean
}) =>
  getApiClient().request<SetBillingModuleResult, SetBillingModuleBody>({
    method: "post",
    url: `/workspaces/${p.workspaceId}/billing/modules`,
    data: { module: p.module, enabled: p.enabled },
  })

// Forgets the saved card: renewals are no longer charged automatically.
export const removeBillingCard = async (p: { workspaceId: string }) =>
  getApiClient().request<RemoveBillingCardResult>({
    method: "delete",
    url: `/workspaces/${p.workspaceId}/billing/payment-method`,
  })

// How renewals are charged (1 or 12 months) — without paying now.
export const setBillingPeriod = async (p: { workspaceId: string; periodMonths: 1 | 12 }) =>
  getApiClient().request<SetBillingPeriodResult, SetBillingPeriodBody>({
    method: "put",
    url: `/workspaces/${p.workspaceId}/billing/period`,
    data: { periodMonths: p.periodMonths },
  })

export const getWorkspaceOnboarding = async (p: { workspaceId: string }) =>
  getApiClient().request<WorkspaceOnboarding>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/onboarding`,
  })

// Public: read on /sign-up before anyone has signed in.
export const getSelfServeConfig = async () =>
  getApiClient().request<SelfServeConfig>({
    method: "get",
    url: "/self-serve/config",
  })

export const createSelfServeWorkspace = async (
  body: CreateSelfServeWorkspaceBody,
) =>
  getApiClient().request<
    CreateSelfServeWorkspaceResult,
    CreateSelfServeWorkspaceBody
  >({
    method: "post",
    url: "/self-serve/workspaces",
    data: body,
  })
