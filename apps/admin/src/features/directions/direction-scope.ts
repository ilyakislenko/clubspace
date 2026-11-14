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

export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
