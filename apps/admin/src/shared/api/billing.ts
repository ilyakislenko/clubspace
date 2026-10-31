import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Platform billing of the club (what the club pays ClubSpace) — not the club's
// own abonements, which live in subscriptions.ts.
export type WorkspaceBillingPage = ApiTypes.GetWorkspaceBillingOutputOutput
export type WorkspaceBilling = WorkspaceBillingPage["billing"]
export type PlatformPlan = WorkspaceBillingPage["plans"][number]
export type WorkspaceOnboarding = ApiTypes.GetWorkspaceOnboardingOutputOutput
export type SelfServeConfig = ApiTypes.GetSelfServeConfigOutputOutput
export type CreateSelfServeWorkspaceBody = ApiTypes.CreateSelfServeWorkspaceInputDto
export type CreateSelfServeWorkspaceResult =
  ApiTypes.CreateSelfServeWorkspaceOutputOutput

export const getWorkspaceBilling = async (p: { workspaceId: string }) =>
  getApiClient().request<WorkspaceBillingPage>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/billing`,
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
