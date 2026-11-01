import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Помощь с подключением»: the club asks the ClubSpace team to set it up — a
// paid service covered by the setup fee (charged with the first paid period,
// unless the platform waived it).
export type OnboardingHelp = ApiTypes.GetWorkspaceOnboardingHelpOutputOutput
export type OnboardingHelpRequest = NonNullable<OnboardingHelp["request"]>
export type SetupFeeState = OnboardingHelp["setupFee"]["state"]
export type RequestOnboardingHelpBody = ApiTypes.RequestWorkspaceOnboardingHelpInputDto

export const getOnboardingHelp = async (p: { workspaceId: string }) =>
  getApiClient().request<OnboardingHelp>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/onboarding-help`,
  })

// Files a request, or updates the club's open one.
export const requestOnboardingHelp = async (p: {
  workspaceId: string
  body: RequestOnboardingHelpBody
}) =>
  getApiClient().request<
    ApiTypes.RequestWorkspaceOnboardingHelpOutputOutput,
    RequestOnboardingHelpBody
  >({
    method: "post",
    url: `/workspaces/${p.workspaceId}/onboarding-help`,
    data: p.body,
  })
