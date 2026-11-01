"use client"

import { useEffect, useMemo, useRef } from "react"

import { cn } from "@clubspace/ui-kit/util"

import {
  DOW_SHORT,
  formatHm,
  formatRange,
  HOUR_HEIGHT,
  isoDow,
  layoutDay,
  minuteToY,
  PX_PER_MINUTE,
  visibleHours,
  type BlockPlace,
  type HourRange,
} from "./calendar-helpers"
import type { CalendarItem, ClassItem } from "./calendar-items"
import { EventBlock } from "./EventBlock"
import { useGridDrag, type DragTarget } from "./use-grid-drag"

const QUARTERS = [0, 15, 30, 45] as const

type Props = {
  days: string[]
  items: CalendarItem[]
  today: string
  nowMin: number
  hours: HourRange
  workingHours: HourRange
  canCreate: boolean
  // Live check while dragging: true paints the preview amber.
  hasConflict: (item: ClassItem, target: DragTarget) => boolean
  onCreateAt: (date: string, startMin: number) => void
  onOpenItem: (item: CalendarItem) => void
  onDrop: (item: ClassItem, target: DragTarget) => void
  onOpenDay?: (date: string) => void
}

/**
 * Week (7 columns) and day (1 column) time grid, after volt's
 * calendar-week-view / calendar-day-view: hour labels sit on the hour lines,
 * dashed half-hour lines, 15-minute cells to create a class, blocks laid out
 * side by side when they overlap, the current-time line, drag & resize.
 */
export function TimeGridView({
  days,
  items,
  today,
  nowMin,
  hours,
  workingHours,
  canCreate,
  hasConflict,
  onCreateAt,
  onOpenItem,
  onDrop,
  onOpenDay,
}: Props) {
  const detailed = days.length === 1
  const dayItems = useMemo(
    () => items.filter((it) => days.includes(it.date)),
    [items, days],
  )
  const range = useMemo(() => visibleHours(hours, dayItems), [hours, dayItems])
  const hourList = useMemo(
    () => Array.from({ length: range.to - range.from }, (_, i) => range.from + i),
    [range],
  )
  const height = hourList.length * HOUR_HEIGHT

  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { drag, begin, consumeClick } = useGridDrag({
    days,
    range,
    gridRef,
    scrollRef,
    onDrop,
  })

  const layouts = useMemo(() => {
    const out = new Map<string, Map<string, BlockPlace>>()
    for (const day of days) {
      out.set(day, layoutDay(dayItems.filter((it) => it.date === day)))
    }
    return out
  }, [days, dayItems])

  // Land on the morning's first class (or on "now" today) instead of 00:00.
  const firstStart = dayItems.reduce(
    (min, it) => Math.min(min, it.startMin),
    Number.POSITIVE_INFINITY,
  )
  const focusMin = days.includes(today)
    ? nowMin - 90
    : Number.isFinite(firstStart)
      ? firstStart - 30
      : workingHours.from * 60
  const daysKey = days.join(",")
  useEffect(() => {
    const box = scrollRef.current
    if (box) box.scrollTop = Math.max(0, minuteToY(focusMin, range))
    // Only when the shown days change — not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey])

  const showNow = days.includes(today) && nowMin >= range.from * 60 && nowMin < range.to * 60

  return (
    <div
      ref={scrollRef}
      data-calendar-scroll
      className="relative h-[calc(100svh-17rem)] min-h-[420px] overflow-y-auto rounded-lg border border-border bg-card"
    >
      {/* Day header: inside the scroll box so it lines up with the columns. */}
      <div className="sticky top-0 z-30 flex border-b border-border bg-card">
        <div className="w-16 shrink-0" />
        <div
          className="grid flex-1 divide-x divide-border border-l border-border"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((day) => {
            const isToday = day === today
            const count = dayItems.filter((it) => it.date === day && it.kind === "class" && !it.cancelled).length
            return (
              <button
                key={day}
                type="button"
                onClick={() => onOpenDay?.(day)}
                disabled={!onOpenDay}
                className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground enabled:hover:bg-accent"
              >
                <span>{DOW_SHORT[isoDow(day)]}</span>
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold text-foreground",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {Number(day.slice(8, 10))}
                </span>
                {detailed && count > 0 && (
                  <span className="text-muted-foreground">· {count} зан.</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex">
        {/* Hours column: each label is centered on its hour line. */}
        <div className="relative w-16 shrink-0" style={{ height }}>
          {hourList.map((hour, i) =>
            i === 0 ? null : (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground"
                style={{ top: i * HOUR_HEIGHT }}
              >
                {formatHm(hour * 60)}
              </span>
            ),
          )}
          {showNow && (
            <span
              className="absolute right-1 z-20 -translate-y-1/2 rounded bg-background px-1 text-xs font-semibold tabular-nums text-red-600"
              style={{ top: minuteToY(nowMin, range) }}
            >
              {formatHm(nowMin)}
            </span>
          )}
        </div>

        <div
          ref={gridRef}
          data-calendar-grid
          data-range-from={range.from}
          className={cn(
            "relative grid flex-1 divide-x divide-border border-l border-border",
            drag && "cursor-grabbing select-none",
          )}
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, height }}
        >
          {days.map((day) => {
            const layout = layouts.get(day)
            return (
              <div key={day} className="relative" data-calendar-day={day}>
                {hourList.map((hour, i) => (
                  <div
                    key={hour}
                    data-hour-line={hour}
                    className={cn(
                      "relative",
                      i !== 0 && "border-t border-border",
                      (hour < workingHours.from || hour >= workingHours.to) &&
                        "bg-muted/50",
                    )}
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/70" />
                    {canCreate &&
                      QUARTERS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          tabIndex={-1}
                          aria-label={`Новое занятие ${formatHm(hour * 60 + q)}`}
                          data-calendar-cell={`${day} ${formatHm(hour * 60 + q)}`}
                          className="absolute inset-x-0 cursor-cell transition-colors hover:bg-accent/70"
                          style={{
                            top: (q / 60) * HOUR_HEIGHT,
                            height: HOUR_HEIGHT / 4,
                          }}
                          onClick={() => onCreateAt(day, hour * 60 + q)}
                        />
                      ))}
                  </div>
                ))}

                {dayItems
                  .filter((it) => it.date === day)
                  .map((it) => {
                    const place = layout?.get(it.key) ?? { left: 0, width: 1 }
                    const dragging = drag?.item.key === it.key
                    const isClass = it.kind === "class"
                    return (
                      <div
                        key={it.key}
                        className={cn("absolute z-10", dragging && "pointer-events-none")}
                        style={{
                          // 1px inside the hour lines so back-to-back classes
                          // stay apart and edges sit on the grid.
                          top: minuteToY(it.startMin, range) + 1,
                          height: Math.max((it.endMin - it.startMin) * PX_PER_MINUTE - 2, 14),
                          left: `calc(${place.left * 100}% + 2px)`,
                          width: `calc(${place.width * 100}% - 4px)`,
                        }}
                      >
                        <EventBlock
                          item={it}
                          detailed={detailed}
                          state={dragging ? "dragging" : undefined}
                          className={isClass && it.editable ? "touch-none" : undefined}
                          onOpen={() => {
                            if (consumeClick()) return
                            onOpenItem(it)
                          }}
                          onPointerDownMove={
                            isClass && it.editable
                              ? (e) => begin(e, it, "move")
                              : undefined
                          }
                          onPointerDownResize={
                            isClass && it.editable
                              ? (e) => begin(e, it, "resize")
                              : undefined
                          }
                        />
                      </div>
                    )
                  })}

                {drag && drag.target.date === day && (
                  <div
                    data-calendar-preview
                    className="pointer-events-none absolute inset-x-0.5 z-20"
                    style={{
                      top: minuteToY(drag.target.startMin, range) + 1,
                      height: (drag.target.endMin - drag.target.startMin) * PX_PER_MINUTE - 2,
                    }}
                  >
                    <EventBlock
                      item={drag.item}
                      startMin={drag.target.startMin}
                      endMin={drag.target.endMin}
                      detailed={detailed}
                      state={hasConflict(drag.item, drag.target) ? "conflict" : "preview"}
                    />
                    <span className="absolute -top-6 left-1 rounded bg-foreground px-1.5 py-0.5 text-xs font-semibold tabular-nums text-background shadow">
                      {formatRange(drag.target.startMin, drag.target.endMin)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {showNow && (
            <div
              data-calendar-now
              className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
              style={{ top: minuteToY(nowMin, range) - 1 }}
            >
              <div
                className="absolute -top-[5px] size-2 -translate-x-1/2 rounded-full bg-red-500"
                style={{ left: `${(days.indexOf(today) / days.length) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
