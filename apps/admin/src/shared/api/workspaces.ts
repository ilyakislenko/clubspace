import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead, invalidateReads } from "./read-cache"

// Sourced from the drift-gated shared contract, which already carries
// roleName + isOwner.
export type WorkspaceSummary =
  ApiTypes.GetMyWorkspacesOutputOutput["data"][number]

// How long the club list (roles, app sections) is kept: the sidebar and pages
// ask for it on every navigation. Writes in this tab that change it drop it.
const WORKSPACES_TTL_MS = 60_000

export const fetchWorkspaces = (
  params: { curPage?: number; perPage?: number } = {}
): Promise<WorkspaceSummary[]> =>
  cachedRead(
    `workspaces:${params.curPage ?? ""}:${params.perPage ?? ""}`,
    async () => {
      const response = await getApiClient().request<
        ApiTypes.GetMyWorkspacesOutputOutput,
        typeof params
      >({
        method: "post",
        url: "/get-my-workspaces",
        data: params,
      })
      return response.data ?? []
    },
    WORKSPACES_TTL_MS,
  )

export type WorkspaceSettings = ApiTypes.GetWorkspaceSettingsOutputOutput

// Shared while in flight only (the shell and the settings page ask at once),
// never kept: each mount reads what the server has now.
export const getWorkspaceSettings = (params: { workspaceId: string }) =>
  cachedRead(`settings:${params.workspaceId}`, () =>
    getApiClient().request<WorkspaceSettings>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/settings`,
    }),
  )

// Any mutable settings field can be PATCHed (all optional). Derived from the
// contract so new app-section flags are accepted automatically.
// `expectedUpdatedAt` = the `updatedAt` read: a stale one answers 409.
export type WorkspaceSettingsPatch = Partial<
  Omit<WorkspaceSettings, "id" | "name" | "lockedFeatures" | "updatedAt">
> & { expectedUpdatedAt?: string }

export const updateWorkspaceSettings = async (
  params: { workspaceId: string } & WorkspaceSettingsPatch
) => {
  const { workspaceId, ...patch } = params
  const updated = await getApiClient().request<WorkspaceSettings, typeof patch>({
    method: "patch",
    url: `/workspaces/${workspaceId}/settings`,
    data: patch,
  })
  // App sections live in the club list too.
  invalidateReads(`settings:${workspaceId}`, "workspaces")
  return updated
}
