"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import type { Direction } from "../../shared/api/directions"
import { DirectionDot } from "./DirectionChip"

// "all" = no filter, "club" = only club-wide rows, otherwise a direction id.
export type DirectionFilterValue = string

export const ALL_DIRECTIONS: DirectionFilterValue = "all"
const CLUB_ONLY: DirectionFilterValue = "club"

export const matchesDirectionFilter = (
  filter: DirectionFilterValue,
  directionId: string | null | undefined,
): boolean => {
  if (filter === ALL_DIRECTIONS) return true
  if (filter === CLUB_ONLY) return !directionId
  return directionId === filter
}

/** Query param for list endpoints that filter server-side (direction only). */
export const directionFilterParam = (
  filter: DirectionFilterValue,
): string | undefined =>
  filter === ALL_DIRECTIONS || filter === CLUB_ONLY ? undefined : filter

/** List filter by direction; hidden when the club has no directions. */
export function DirectionFilter({
  directions,
  value,
  onChange,
  includeClubOnly = true,
}: {
  directions: Direction[]
  value: DirectionFilterValue
  onChange: (value: DirectionFilterValue) => void
  // Server-filtered lists can't express "club-wide only".
  includeClubOnly?: boolean
}) {
  if (directions.length === 0) return null
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-56" aria-label="Фильтр по направлению">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_DIRECTIONS}>Все направления</SelectItem>
        {includeClubOnly && (
          <SelectItem value={CLUB_ONLY}>Только для всего клуба</SelectItem>
        )}
        {directions.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            <span className="inline-flex items-center gap-2">
              <DirectionDot color={d.color} />
              {d.icon && <span aria-hidden>{d.icon}</span>}
              {d.name}
              {!d.isActive && (
                <span className="text-xs text-muted-foreground">
                  (в архиве)
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
