import { kvDelete, kvGet, kvSet } from "../../shared/kv"

// The gym chip last picked on the club schedule, per club — one entry holding
// every club's pick, so sign-out clears it at once and the next account on
// this device starts from all gyms. SecureStore keys allow [A-Za-z0-9._-] only.
const KEY = "clubspace.scheduleGym"

type GymFilters = Record<string, string>

const readAll = async (): Promise<GymFilters> => {
  const raw = await kvGet(KEY).catch(() => null)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as GymFilters) : {}
  } catch {
    return {}
  }
}

export const loadGymFilter = async (workspaceId: string): Promise<string | null> =>
  (await readAll())[workspaceId] ?? null

export const saveGymFilter = async (
  workspaceId: string,
  gymId: string | null,
): Promise<void> => {
  const all = await readAll()
  if (gymId) all[workspaceId] = gymId
  else delete all[workspaceId]
  await kvSet(KEY, JSON.stringify(all)).catch(() => undefined)
}

export const clearGymFilters = (): Promise<void> =>
  kvDelete(KEY).catch(() => undefined)
