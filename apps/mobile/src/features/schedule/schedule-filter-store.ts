import { kvDelete, kvGet, kvSet } from "../../shared/kv"

// The club schedule's last filter, per club: one entry for the gym chips and
// one for the directions, each holding every club's pick, so sign-out clears
// them at once and the next account on this device starts from everything.
// SecureStore keys allow [A-Za-z0-9._-] only.
const GYM_KEY = "clubspace.scheduleGym"
const DIRECTION_KEY = "clubspace.scheduleDirections"

type Filters = Record<string, string[]>

// A club's pick: a list of ids. The gym entry once held a single id per club;
// it reads as a one-item list.
const idsOf = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : []

const readAll = async (key: string): Promise<Filters> => {
  const raw = await kvGet(key).catch(() => null)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return Object.fromEntries(
      Object.entries(parsed).map(([club, value]) => [club, idsOf(value)]),
    )
  } catch {
    return {}
  }
}

const load = async (key: string, workspaceId: string): Promise<string[]> =>
  (await readAll(key))[workspaceId] ?? []

const save = async (
  key: string,
  workspaceId: string,
  ids: readonly string[],
): Promise<void> => {
  const all = await readAll(key)
  if (ids.length > 0) all[workspaceId] = [...ids]
  else delete all[workspaceId]
  await kvSet(key, JSON.stringify(all)).catch(() => undefined)
}

// «Мои группы» or the picked gyms; [] = everything.
export const loadGymFilter = (workspaceId: string): Promise<string[]> =>
  load(GYM_KEY, workspaceId)

export const saveGymFilter = (
  workspaceId: string,
  ids: readonly string[],
): Promise<void> => save(GYM_KEY, workspaceId, ids)

// The picked directions; [] = «Все».
export const loadDirectionFilter = (workspaceId: string): Promise<string[]> =>
  load(DIRECTION_KEY, workspaceId)

export const saveDirectionFilter = (
  workspaceId: string,
  ids: readonly string[],
): Promise<void> => save(DIRECTION_KEY, workspaceId, ids)

export const clearScheduleFilters = async (): Promise<void> => {
  await Promise.all(
    [GYM_KEY, DIRECTION_KEY].map((key) => kvDelete(key).catch(() => undefined)),
  )
}
