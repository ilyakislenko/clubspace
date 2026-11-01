"use client"

import type { ReactNode } from "react"

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import type { Direction } from "../../shared/api/directions"
import { DirectionDot } from "./DirectionChip"

// Radix Select can't carry an empty value — "club" stands for null.
const CLUB = "club"

type Props = {
  directions: Direction[]
  value: string | null
  onChange: (directionId: string | null) => void
  id?: string
  label?: string
  hint?: ReactNode
  disabled?: boolean
  triggerClassName?: string
}

/**
 * «Весь клуб» (null) + the club's active directions. Renders nothing when the
 * club has no directions, so forms look exactly as before. An archived
 * direction stays selectable only while it is the current value — editing an
 * old row must not silently move it to the whole club.
 */
export function DirectionSelect({
  directions,
  value,
  onChange,
  id,
  label = "Направление",
  hint,
  disabled,
  triggerClassName,
}: Props) {
  if (directions.length === 0) return null
  const options = directions.filter((d) => d.isActive || d.id === value)
  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select
        value={value ?? CLUB}
        onValueChange={(v) => onChange(v === CLUB ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CLUB}>Весь клуб</SelectItem>
          {options.map((d) => (
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
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
