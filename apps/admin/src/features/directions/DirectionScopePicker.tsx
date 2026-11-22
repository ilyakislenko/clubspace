"use client"

import type { ReactNode } from "react"

import { Label } from "@clubspace/ui-kit/ui"

import type { Direction, DirectionRef } from "../../shared/api/directions"
import { DirectionChip, DirectionDot } from "./DirectionChip"
import { toggleId } from "./direction-scope"

const chipClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
  }`

/**
 * Scope of a set-scoped row (tariff): «Весь клуб» (= nothing picked) or any
 * set of the club's active directions. Renders nothing when the club has no
 * directions. A picked archived direction stays visible so editing never
 * silently drops it.
 */
export function DirectionScopePicker({
  directions,
  value,
  onChange,
  label = "Направления",
  hint,
}: {
  directions: Direction[]
  value: readonly string[]
  onChange: (directionIds: string[]) => void
  label?: string
  hint?: ReactNode
}) {
  if (directions.length === 0) return null
  const options = directions.filter((d) => d.isActive || value.includes(d.id))
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value.length === 0}
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
              onClick={() => onChange(toggleId(value, d.id))}
              className={chipClass(active)}
            >
              <DirectionDot color={d.color} className="size-2" />
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
