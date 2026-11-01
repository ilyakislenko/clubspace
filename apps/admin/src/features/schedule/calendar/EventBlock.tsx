"use client"

import { cva, type VariantProps } from "class-variance-authority"
import { CalendarClock, Repeat2, UserRoundCog } from "lucide-react"
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react"

import { cn } from "@clubspace/ui-kit/util"

import { coachShortName } from "./calendar-format"
import { formatRange, withAlpha } from "./calendar-helpers"
import { fillLabel, isFull, type CalendarItem } from "./calendar-items"
import { substitutionLabel } from "./substitution"

// Ported from volt's week/day event card: one cva for the shape, the direction
// color goes in as inline style (club directions carry arbitrary hex colors).
const blockVariants = cva(
  "group/block relative flex h-full select-none flex-col overflow-hidden rounded-md border border-l-[3px] px-1.5 text-xs leading-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      kind: {
        class: "",
        event: "border-dashed",
      },
      state: {
        idle: "shadow-sm",
        cancelled: "opacity-60 [&_.block-title]:line-through",
        dragging: "opacity-40",
        preview: "shadow-lg ring-2 ring-primary",
        conflict: "shadow-lg ring-2 ring-amber-500",
      },
      size: {
        tiny: "justify-center py-0",
        compact: "py-0.5",
        regular: "gap-0.5 py-1",
      },
      interactive: {
        true: "cursor-grab active:cursor-grabbing",
        false: "cursor-pointer",
      },
    },
    defaultVariants: {
      kind: "class",
      state: "idle",
      size: "regular",
      interactive: false,
    },
  },
)

type BlockVariants = VariantProps<typeof blockVariants>

export const blockSize = (minutes: number): NonNullable<BlockVariants["size"]> =>
  minutes < 35 ? "tiny" : minutes < 55 ? "compact" : "regular"

type Props = {
  item: CalendarItem
  // Overrides the item's own time (the drag preview shows the target time).
  startMin?: number
  endMin?: number
  state?: BlockVariants["state"]
  // Day view: room for gym / coach lines.
  detailed?: boolean
  className?: string
  style?: CSSProperties
  onOpen?: () => void
  onPointerDownMove?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerDownResize?: (e: PointerEvent<HTMLDivElement>) => void
}

export function EventBlock({
  item,
  startMin = item.startMin,
  endMin = item.endMin,
  state = item.cancelled ? "cancelled" : "idle",
  detailed = false,
  className,
  style,
  onOpen,
  onPointerDownMove,
  onPointerDownResize,
}: Props) {
  const minutes = endMin - startMin
  const size = blockSize(minutes)
  const color = item.color
  const session = item.kind === "class" ? item.session : null
  const fill = session ? fillLabel(session) : null
  const sub = session ? substitutionLabel(session) : null
  const interactive = item.editable && !!onPointerDownMove
  // Narrow week columns truncate everything — the hover tip has it all.
  const tooltip = [
    item.title,
    item.cancelled ? "Отменено" : formatRange(startMin, endMin),
    session && [session.group.gym?.name, coachShortName(session.group.coach)].filter(Boolean).join(" · "),
    sub,
    fill && `Записано ${fill}`,
  ]
    .filter(Boolean)
    .join("\n")

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onOpen?.()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-calendar-block={item.key}
      aria-label={`${item.title}, ${formatRange(startMin, endMin)}`}
      title={state === "idle" || state === "cancelled" ? tooltip : undefined}
      className={cn(
        blockVariants({ kind: item.kind, state, size, interactive }),
        className,
      )}
      style={{
        backgroundColor: withAlpha(color, item.kind === "event" ? 0.08 : 0.16),
        borderColor: withAlpha(color, 0.45),
        borderLeftColor: withAlpha(color, 1),
        ...style,
      }}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDownMove}
    >
      <div className="flex min-w-0 items-center gap-1">
        {item.kind === "event" && (
          <CalendarClock aria-hidden className="size-3 shrink-0 opacity-70" />
        )}
        <span className="block-title truncate font-semibold">{item.title}</span>
        {session?.rescheduledFrom && (
          <Repeat2
            aria-label="Перенесено"
            className="size-3 shrink-0 text-sky-600 dark:text-sky-400"
          />
        )}
        {fill && size !== "regular" && (
          <span
            className={cn(
              "ml-auto shrink-0 tabular-nums font-semibold",
              session && isFull(session) ? "text-amber-700 dark:text-amber-400" : "opacity-80",
            )}
          >
            {fill}
          </span>
        )}
      </div>
      {size !== "tiny" && (
        <div className="flex min-w-0 items-center gap-1 tabular-nums opacity-80">
          <span className="truncate">
            {item.cancelled ? "Отменено" : formatRange(startMin, endMin)}
          </span>
          {fill && size === "regular" && (
            <span
              className={cn(
                "ml-auto shrink-0 rounded px-1 font-semibold",
                session && isFull(session)
                  ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                  : "bg-background/60",
              )}
            >
              {fill}
            </span>
          )}
        </div>
      )}
      {size === "regular" && sub && (
        <div className="flex min-w-0 items-center gap-1 font-medium text-amber-800 dark:text-amber-300">
          <UserRoundCog aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{sub}</span>
        </div>
      )}
      {size === "regular" && (detailed || minutes >= 75) && session && (
        <div className="truncate opacity-70">
          {[session.group.gym?.name, coachShortName(session.group.coach)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {onPointerDownResize && item.editable && (
        <div
          aria-hidden
          data-resize-handle
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover/block:opacity-100"
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e)
          }}
        >
          <div className="mx-auto mt-0.5 h-1 w-6 rounded-full bg-foreground/40" />
        </div>
      )}
    </div>
  )
}
