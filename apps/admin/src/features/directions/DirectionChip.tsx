"use client"

import type { DirectionRef } from "../../shared/api/directions"

type DirectionLike = Pick<DirectionRef, "name" | "color" | "icon">

const FALLBACK_COLOR = "#94a3b8"

export function DirectionDot({
  color,
  className = "size-2.5",
}: {
  color: string | null
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color ?? FALLBACK_COLOR }}
    />
  )
}

// Small colored «БЖЖ»-style tag for rows scoped to a direction. Renders
// nothing for club-wide rows (direction = null).
export function DirectionChip({
  direction,
}: {
  direction: DirectionLike | null | undefined
}) {
  if (!direction) return null
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
      <DirectionDot color={direction.color} className="size-2" />
      {direction.icon && <span aria-hidden>{direction.icon}</span>}
      <span className="truncate">{direction.name}</span>
    </span>
  )
}
