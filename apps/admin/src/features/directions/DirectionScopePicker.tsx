"use client"

import type { ReactNode } from "react"

import { Label } from "@clubspace/ui-kit/ui"

import type { Direction, DirectionRef } from "../../shared/api/directions"
import { DirectionChip, DirectionDot } from "./DirectionChip"
import { toggleId } from "./direction-scope"

const chipClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
  }`

const LOCKED_HINT =
  "Менять может руководитель этого направления или администратор"

/**
 * Scope of a set-scoped row (tariff): «Весь клуб» (= nothing picked) or any
 * set of the club's active directions. Renders nothing when the club has no
 * directions. A picked archived direction stays visible so editing never
 * silently drops it. `allowedIds` (direction manager) locks every other chip
 * and «Весь клуб».
 */
export function DirectionScopePicker({
  directions,
  value,
  onChange,
  label = "Направления",
  hint,
  allowedIds,
}: {
  directions: Direction[]
  value: readonly string[]
  onChange: (directionIds: string[]) => void
  label?: string
  hint?: ReactNode
  allowedIds?: readonly string[]
}) {
  if (directions.length === 0) return null
  const options = directions.filter((d) => d.isActive || value.includes(d.id))
  const locked = (id: string) => !!allowedIds && !allowedIds.includes(id)
  const clubLocked = !!allowedIds && value.length > 0
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value.length === 0}
          disabled={clubLocked}
          title={clubLocked ? LOCKED_HINT : undefined}
          onClick={() => onChange([])}
          className={chipClass(value.length === 0)}
        >
          Весь клуб
        </button>
        {options.map((d) => {
          const active = value.includes(d.id)
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={active}
              disabled={locked(d.id)}
              title={locked(d.id) ? LOCKED_HINT : undefined}
              onClick={() => onChange(toggleId(value, d.id))}
              className={chipClass(active)}
            >
              <DirectionDot color={d.color} className="size-2" />
              {d.icon && <span aria-hidden>{d.icon}</span>}
              {d.name}
              {!d.isActive && <span className="font-normal">(в архиве)</span>}
            </button>
          )
        })}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Scope chips of an abonement/tariff; nothing for a club-wide one. */
export function DirectionScopeChips({
  directions,
}: {
  directions: readonly DirectionRef[]
}) {
  if (directions.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {directions.map((d) => (
        <DirectionChip key={d.id} direction={d} />
      ))}
    </span>
  )
}
