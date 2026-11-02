"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { cn } from "@clubspace/ui-kit/util"

import { pluralRu } from "../../../shared/lib/plural-ru"
import {
  blockFit,
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
import type { CalendarItem, ClassItem, HallColumn } from "./calendar-items"
import type { CreateSlotRequest } from "./CreateSlotDialog"
import { EventBlock } from "./EventBlock"
import { useGridDrag, type DragTarget } from "./use-grid-drag"

const QUARTERS = [0, 15, 30, 45] as const

// A hall column never gets narrower than this: the halls scroll sideways
// under the pinned time axis instead of squeezing the group names.
const HALL_MIN_REM = 11

// One grid column: a day, or one hall of the single day shown.
type Column = { key: string; date: string; hall: HallColumn | null }

type Props = {
  days: string[]
  // Day view «По залам»: a column per hall of `days[0]`.
  halls?: readonly HallColumn[]
  items: CalendarItem[]
  today: string
  nowMin: number
  hours: HourRange
  workingHours: HourRange
  canCreate: boolean
  // Live check while dragging: true paints the preview amber.
  hasConflict: (item: ClassItem, target: DragTarget) => boolean
  onCreateAt: (at: CreateSlotRequest) => void
  onOpenItem: (item: CalendarItem) => void
  onDrop: (item: ClassItem, target: DragTarget) => void
  onOpenDay?: (date: string) => void
}

/**
 * Week (7 columns) and day (1 column, or a column per hall) time grid, after
 * volt's calendar-week-view / calendar-day-view: hour labels sit on the hour
 * lines, dashed half-hour lines, 15-minute cells to create a class, blocks laid
 * out side by side when they overlap, the current-time line, drag & resize.
 * A hall is a group's, not a single class's, so a drag between hall columns
 * moves the class in time only and the preview stays in its own hall.
 */
export function TimeGridView({
  days,
  halls,
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
  const byHall = detailed && !!halls && halls.length > 0
  const columns = useMemo<Column[]>(
    () =>
      byHall && halls
        ? halls.map((hall) => ({ key: `hall:${hall.id ?? "none"}`, date: days[0], hall }))
        : days.map((day) => ({ key: day, date: day, hall: null })),
    [byHall, halls, days],
  )
  const dayItems = useMemo(
    () => items.filter((it) => days.includes(it.date)),
    [items, days],
  )
  const columnItems = useMemo(() => {
    const out = new Map<string, CalendarItem[]>()
    for (const col of columns) {
      out.set(
        col.key,
        dayItems.filter((it) => it.date === col.date && (!col.hall || it.gymId === col.hall.id)),
      )
    }
    return out
  }, [columns, dayItems])
  const range = useMemo(() => visibleHours(hours, dayItems), [hours, dayItems])
  const hourList = useMemo(
    () => Array.from({ length: range.to - range.from }, (_, i) => range.from + i),
    [range],
  )
  const height = hourList.length * HOUR_HEIGHT

  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const columnDates = useMemo(() => columns.map((c) => c.date), [columns])
  const { drag, begin, consumeClick } = useGridDrag({
    columnDates,
    range,
    gridRef,
    scrollRef,
    onDrop,
  })

  const layouts = useMemo(() => {
    const out = new Map<string, Map<string, BlockPlace>>()
    for (const [key, list] of columnItems) out.set(key, layoutDay(list))
    return out
  }, [columnItems])

  // The grid's width, for how much a narrow block can show (blockFit).
  const [gridWidth, setGridWidth] = useState(0)
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = () => setGridWidth(grid.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

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
  // A hall running classes side by side gets a lane of the minimum width for each.
  const lanes = columns.map((col) =>
    byHall ? Math.max(1, ...[...(layouts.get(col.key)?.values() ?? [])].map((p) => Math.round(1 / p.width))) : 1,
  )
  const template = byHall
    ? lanes.map((n) => `minmax(${n * HALL_MIN_REM}rem, ${n}fr)`).join(" ")
    : `repeat(${columns.length}, minmax(0, 1fr))`
  // Both rows grow past the box together, so the header stays over its column.
  const rowWidth = byHall
    ? { minWidth: `calc(4rem + ${lanes.reduce((a, b) => a + b, 0) * HALL_MIN_REM}rem)` }
    : undefined

  return (
    <div
      ref={scrollRef}
      data-calendar-scroll
      className="relative h-[calc(100svh-17rem)] min-h-[420px] overflow-auto rounded-lg border border-border bg-card"
    >
      {/* Column header: inside the scroll box so it lines up with the columns. */}
      <div className="sticky top-0 z-30 flex border-b border-border bg-card" style={rowWidth}>
        <div className="sticky left-0 z-10 w-16 shrink-0 bg-card" />
        <div
          className="grid flex-1 divide-x divide-border border-l border-border"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((col) => {
            const count = (columnItems.get(col.key) ?? []).filter(
              (it) => it.kind === "class" && !it.cancelled,
            ).length
            if (col.hall) {
              return (
                <div
                  key={col.key}
                  data-calendar-hall={col.hall.name}
                  title={[col.hall.name, col.hall.address].filter(Boolean).join("\n")}
                  className="flex min-w-0 flex-col items-center justify-center px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="max-w-full truncate text-sm font-semibold text-foreground">{col.hall.name}</span>
                  <span>
                    {count > 0 ? `${count} ${pluralRu(count, "занятие", "занятия", "занятий")}` : "нет занятий"}
                  </span>
                </div>
              )
            }
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => onOpenDay?.(col.date)}
                disabled={!onOpenDay}
                className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground enabled:hover:bg-accent"
              >
                <span>{DOW_SHORT[isoDow(col.date)]}</span>
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold text-foreground",
                    col.date === today && "bg-primary text-primary-foreground",
                  )}
                >
                  {Number(col.date.slice(8, 10))}
                </span>
                {detailed && count > 0 && (
                  <span className="text-muted-foreground">· {count} зан.</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex" style={rowWidth}>
        {/* Hours column: each label is centered on its hour line; pinned while halls scroll sideways. */}
        <div className="sticky left-0 z-[25] w-16 shrink-0 bg-card" style={{ height }}>
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
          style={{ gridTemplateColumns: template, height }}
        >
          {columns.map((col) => {
            const layout = layouts.get(col.key)
            const creatable = canCreate && (col.hall?.canCreate ?? true)
            return (
              <div
                key={col.key}
                className="relative"
                data-calendar-day={col.date}
                data-calendar-column={col.hall?.name}
              >
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
                    {creatable &&
                      QUARTERS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          tabIndex={-1}
                          aria-label={`Новое занятие ${formatHm(hour * 60 + q)}${col.hall ? `, ${col.hall.name}` : ""}`}
                          data-calendar-cell={`${col.date} ${formatHm(hour * 60 + q)}`}
                          className="absolute inset-x-0 cursor-cell transition-colors hover:bg-accent/70"
                          style={{
                            top: (q / 60) * HOUR_HEIGHT,
                            height: HOUR_HEIGHT / 4,
                          }}
                          onClick={() => {
                            const startMin = hour * 60 + q
                            onCreateAt(
                              col.hall
                                ? { date: col.date, startMin, gymId: col.hall.id }
                                : { date: col.date, startMin },
                            )
                          }}
                        />
                      ))}
                  </div>
                ))}

                {(columnItems.get(col.key) ?? []).map((it) => {
                  const place = layout?.get(it.key) ?? { left: 0, width: 1 }
                  // Hall columns keep a minimum lane width, so only a shared
                  // day column gets slivers; unmeasured (0) shows everything.
                  const fit =
                    byHall || gridWidth === 0
                      ? "full"
                      : blockFit((gridWidth / columns.length) * place.width - 4)
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
                        fit={fit}
                        showGym={!col.hall}
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

                {drag &&
                  drag.target.date === col.date &&
                  (!col.hall || col.hall.id === drag.item.gymId) && (
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
                        showGym={!col.hall}
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
                style={{
                  left: `${(Math.max(0, columnDates.indexOf(today)) / columns.length) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
