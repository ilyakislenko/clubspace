import { ALL_DIRECTIONS, type DirectionFilterValue } from "./DirectionFilter"

// A tariff / abonement scope is a SET of direction ids; empty = «Весь клуб».

/** List filter for set-scoped rows: "club" keeps club-wide ones only. */
export const matchesScopeFilter = (
  filter: DirectionFilterValue,
  directionIds: readonly string[],
): boolean => {
  if (filter === ALL_DIRECTIONS) return true
  if (filter === "club") return directionIds.length === 0
  return directionIds.includes(filter)
}

/**
 * Whether the caller may edit a set-scoped row: a club-wide one is checked as
 * `null`, a scoped one needs every direction of the set (server rule).
 */
export const canManageScope = (
  canManageDirection: (directionId: string | null) => boolean,
  directionIds: readonly string[],
): boolean =>
  directionIds.length === 0
    ? canManageDirection(null)
    : directionIds.every((id) => canManageDirection(id))

export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
