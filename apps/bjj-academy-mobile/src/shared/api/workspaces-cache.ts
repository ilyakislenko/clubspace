import * as SecureStore from "expo-secure-store"

import type { WorkspaceSummary } from "./workspaces"

// Last-known workspaces list, persisted so the app can restore an authenticated
// session offline (a network error on launch must NOT log the user out — see
// auth-context). Small payload: a handful of workspaces, a few fields each.
const WORKSPACES_CACHE_KEY = "bjj.workspacesCache"

export const persistWorkspacesCache = async (
  list: WorkspaceSummary[],
): Promise<void> => {
  try {
    await SecureStore.setItemAsync(WORKSPACES_CACHE_KEY, JSON.stringify(list))
  } catch {
    /* best-effort cache — a write failure just means no offline restore */
  }
}

export const loadWorkspacesCache = async (): Promise<WorkspaceSummary[]> => {
  try {
    const raw = await SecureStore.getItemAsync(WORKSPACES_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as WorkspaceSummary[]) : []
  } catch {
    return []
  }
}

export const clearWorkspacesCache = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(WORKSPACES_CACHE_KEY)
  } catch {
    /* noop */
  }
}

// Which workspace to make active: the last one the user explicitly picked,
// else the first with live access, else anything (so AccessExpiredScreen has
// something to show), else null. Pure so it's shared by the online + offline
// paths and unit-testable.
export const pickActiveWorkspace = (
  list: WorkspaceSummary[],
  storedId: string | null,
): WorkspaceSummary | null =>
  list.find((w) => w.workspaceId === storedId) ??
  list.find((w) => !w.accessExpired) ??
  list[0] ??
  null
