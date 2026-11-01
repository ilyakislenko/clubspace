import { kvDelete, kvGet, kvSet } from "../kv"
import { profileKvKey } from "../profile-scope"
import type { WorkspaceSummary } from "./workspaces"

// Last-known workspaces list, persisted so the app can restore an authenticated
// session offline (a network error on launch must NOT log the user out — see
// auth-context). Small payload: a handful of workspaces, a few fields each.
// Persisted via the cross-platform kv store so it survives on the web PWA too
// (SecureStore has no web backend — see shared/kv).
// One list per profile: a child acting profile has its own clubs
// (`profileId` null = the signed-in guardian).
const WORKSPACES_CACHE_KEY = "clubspace.workspacesCache"
// The club last picked, per profile too.
const ACTIVE_WORKSPACE_KEY = "clubspace.activeWorkspaceId"

export const persistWorkspacesCache = async (
  list: WorkspaceSummary[],
  profileId: string | null,
): Promise<void> => {
  try {
    await kvSet(
      profileKvKey(WORKSPACES_CACHE_KEY, profileId),
      JSON.stringify(list),
    )
  } catch {
    /* best-effort cache — a write failure just means no offline restore */
  }
}

export const loadWorkspacesCache = async (
  profileId: string | null,
): Promise<WorkspaceSummary[]> => {
  try {
    const raw = await kvGet(profileKvKey(WORKSPACES_CACHE_KEY, profileId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as WorkspaceSummary[]) : []
  } catch {
    return []
  }
}

export const loadActiveWorkspaceId = async (
  profileId: string | null,
): Promise<string | null> =>
  await kvGet(profileKvKey(ACTIVE_WORKSPACE_KEY, profileId)).catch(() => null)

export const persistActiveWorkspaceId = async (
  workspaceId: string | null,
  profileId: string | null,
): Promise<void> => {
  const key = profileKvKey(ACTIVE_WORKSPACE_KEY, profileId)
  await (workspaceId ? kvSet(key, workspaceId) : kvDelete(key)).catch(
    () => undefined,
  )
}

// Both keys of one profile — sign-out wipes every profile it knows of, a child
// that disappeared from the guardian's list is wiped on its own.
export const clearWorkspacesCache = async (
  profileId: string | null,
): Promise<void> => {
  await Promise.all(
    [WORKSPACES_CACHE_KEY, ACTIVE_WORKSPACE_KEY].map((base) =>
      kvDelete(profileKvKey(base, profileId)).catch(() => undefined),
    ),
  )
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
