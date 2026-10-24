import { kvDelete, kvGet, kvSet } from "../../shared/kv"

// The gym chip last picked on the club schedule, per club. SecureStore keys
// allow [A-Za-z0-9._-] only, hence the dots.
const key = (workspaceId: string) => `clubspace.scheduleGym.${workspaceId}`

export const loadGymFilter = async (
  workspaceId: string,
): Promise<string | null> => (await kvGet(key(workspaceId)).catch(() => null)) ?? null

export const saveGymFilter = async (
  workspaceId: string,
  gymId: string | null,
): Promise<void> => {
  if (gymId) await kvSet(key(workspaceId), gymId).catch(() => undefined)
  else await kvDelete(key(workspaceId)).catch(() => undefined)
}
