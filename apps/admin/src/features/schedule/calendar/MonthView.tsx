"use client"

import { useMemo, useState, type DragEvent } from "react"

import { countForm } from "@clubspace/ui-kit/brand"
import { cn } from "@clubspace/ui-kit/util"

import { pluralRu } from "../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../shared/lib/vocabulary"

import {
  DOW_SHORT,
  formatHm,
  monthGridDays,
  sameMonth,
  withAlpha,
} from "./calendar-helpers"
import { groupByDate, type CalendarItem, type ClassItem } from "./calendar-items"
import type { DragTarget } from "./use-grid-drag"

const MAX_VISIBLE = 3
const DRAG_MIME = "application/x-clubspace-class"

type Props = {
  anchor: string
  items: CalendarItem[]
  today: string
  onOpenItem: (item: CalendarItem) => void
  onOpenDay: (date: string) => void
  // A class dropped on another day keeps its time.
  onDrop: (item: ClassItem, target: DragTarget) => void
}

/**
 * Month grid after volt's calendar-month-view (Monday first). Classes are
 * dragged to another day with native HTML5 drag events — the time stays, so
 * there is nothing to snap.
 */
export function MonthView({ anchor, items, today, onOpenItem, onOpenDay, onDrop }: Props) {
  const vocabulary = useVocabulary()
  const days = useMemo(() => monthGridDays(anchor), [anchor])
  const byDate = useMemo(() => groupByDate(items), [items])
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overDay, setOverDay] = useState<string | null>(null)
  const dragged = dragKey
    ? (items.find((it) => it.key === dragKey && it.kind === "class") as ClassItem | undefined)
    : undefined

  const onDropDay = (e: DragEvent, day: string) => {
    e.preventDefault()
    setOverDay(null)
    setDragKey(null)
    if (!dragged || dragged.date === day) return
    onDrop(dragged, { date: day, startMin: dragged.startMin, endMin: dragged.endMin })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
            {DOW_SHORT[d]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const dayItems = byDate.get(day) ?? []
          const inMonth = sameMonth(day, anchor)
          const classes = dayItems.filter((it) => it.kind === "class" && !it.cancelled).length
          return (
            <div
              key={day}
              data-calendar-day={day}
              className={cn(
                "flex min-h-[7.5rem] flex-col gap-1 border-border p-1.5",
                i % 7 !== 0 && "border-l",
                i >= 7 && "border-t",
                !inMonth && "bg-muted/30",
                overDay === day && "bg-primary/10 ring-2 ring-inset ring-primary",
              )}
              onDragOver={(e) => {
                if (!dragged) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (overDay !== day) setOverDay(day)
              }}
              onDragLeave={() => setOverDay((d) => (d === day ? null : d))}
              onDrop={(e) => onDropDay(e, day)}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-semibold hover:bg-accent",
                    !inMonth && "opacity-40",
                    day === today && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {Number(day.slice(8, 10))}
                </button>
                {classes > 0 && (
                  <span
                    className={cn("truncate text-[11px] text-muted-foreground", !inMonth && "opacity-50")}
                  >
                    {classes} {countForm(classes, vocabulary.session, pluralRu)}
                  </span>
                )}
              </div>
              <div className={cn("flex flex-col gap-0.5", !inMonth && "opacity-60")}>
                {dayItems.slice(0, MAX_VISIBLE).map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    draggable={it.kind === "class" && it.editable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, it.key)
                      e.dataTransfer.effectAllowed = "move"
                      setDragKey(it.key)
                    }}
                    onDragEnd={() => {
                      setDragKey(null)
                      setOverDay(null)
                    }}
                    onClick={() => onOpenItem(it)}
                    data-calendar-block={it.key}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-1 rounded border px-1 py-0.5 text-left text-[11px] leading-tight",
                      it.kind === "event" && "border-dashed",
                      it.cancelled && "line-through opacity-60",
                      it.kind === "class" && it.editable && "cursor-grab",
                      dragKey === it.key && "opacity-40",
                    )}
                    style={{
                      backgroundColor: withAlpha(it.color, 0.14),
                      borderColor: withAlpha(it.color, 0.4),
                    }}
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: withAlpha(it.color, 1) }}
                    />
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatHm(it.startMin)}
                    </span>
                    <span className="truncate font-medium">{it.title}</span>
                  </button>
                ))}
                {dayItems.length > MAX_VISIBLE && (
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className="px-1 text-left text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    ещё {dayItems.length - MAX_VISIBLE}…
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
