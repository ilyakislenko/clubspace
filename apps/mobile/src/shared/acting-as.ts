import { kvDelete, kvGet, kvSet } from "./kv"
import { setProfileScopeId } from "./profile-scope"

// The child profile a guardian is acting for, persisted so a relaunch reopens
// the same profile. Cleared on sign-out and when the child is gone from
// /me/dependents or is no longer a confirmed (ACTIVE) child — see auth-context.

export type ActingAs = { id: string; firstname: string; lastname: string | null }

const KEY = "clubspace.actingAs"

const parse = (raw: string | null): ActingAs | null => {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<ActingAs> | null
    return v && typeof v.id === "string" && v.id.length > 0
      ? {
          id: v.id,
          firstname: typeof v.firstname === "string" ? v.firstname : "",
          lastname: typeof v.lastname === "string" ? v.lastname : null,
        }
      : null
  } catch {
    return null
  }
}

/** Reads the stored profile and makes it the active scope. */
export const restoreActingAs = async (): Promise<ActingAs | null> => {
  const stored = parse(await kvGet(KEY).catch(() => null))
  setProfileScopeId(stored?.id ?? null)
  return stored
}

/** Makes `next` the active scope at once (requests, caches) and persists it. */
export const saveActingAs = async (next: ActingAs | null): Promise<void> => {
  setProfileScopeId(next?.id ?? null)
  if (next) await kvSet(KEY, JSON.stringify(next)).catch(() => undefined)
  else await kvDelete(KEY).catch(() => undefined)
}
