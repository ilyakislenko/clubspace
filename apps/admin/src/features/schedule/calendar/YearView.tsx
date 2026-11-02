"use client"

import { useMemo } from "react"

import { countForm } from "@clubspace/ui-kit/brand"
import { cn } from "@clubspace/ui-kit/util"

import { pluralRu } from "../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../shared/lib/vocabulary"

import {
  DOW_SHORT,
  isoDow,
  monthGridDays,
  monthName,
  sameMonth,
} from "./calendar-helpers"
import type { CalendarItem } from "./calendar-items"

type Props = {
  anchor: string
  items: CalendarItem[]
  today: string
  onOpenDay: (date: string) => void
  onOpenMonth: (date: string) => void
}

// How busy a day is, for the dot shade: share of the busiest day.
const shade = (count: number, max: number): string => {
  if (count === 0 || max === 0) return ""
  const r = count / max
  if (r > 0.75) return "bg-primary text-primary-foreground"
  if (r > 0.5) return "bg-primary/70 text-primary-foreground"
  if (r > 0.25) return "bg-primary/40"
  return "bg-primary/20"
}

/** Twelve mini months after volt's calendar-year-view; days shaded by load. */
export function YearView({ anchor, items, today, onOpenDay, onOpenMonth }: Props) {
  const vocabulary = useVocabulary()
  const sessions = (n: number) => `${n} ${countForm(n, vocabulary.session, pluralRu)}`
  const year = anchor.slice(0, 4)
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const it of items) {
      if (it.kind !== "class" || it.cancelled) continue
      out.set(it.date, (out.get(it.date) ?? 0) + 1)
    }
    return out
  }, [items])
  const max = Math.max(0, ...counts.values())

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => {
        const first = `${year}-${String(m + 1).padStart(2, "0")}-01`
        const days = monthGridDays(first)
        let monthTotal = 0
        for (const d of days) if (sameMonth(d, first)) monthTotal += counts.get(d) ?? 0
        return (
          <div key={first} className="flex flex-col rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => onOpenMonth(first)}
              className="flex items-center justify-between rounded-t-lg border-b border-border px-3 py-2 text-sm font-semibold hover:bg-accent"
            >
              {monthName(first)}
              <span className="text-xs font-normal text-muted-foreground">
                {sessions(monthTotal)}
              </span>
            </button>
            <div className="grid grid-cols-7 gap-0.5 p-2 text-center">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <div key={d} className="text-[10px] font-medium text-muted-foreground">
                  {DOW_SHORT[d]}
                </div>
              ))}
              {days.map((d) =>
                sameMonth(d, first) ? (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onOpenDay(d)}
                    title={sessions(counts.get(d) ?? 0)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-full text-[11px] tabular-nums hover:ring-1 hover:ring-ring",
                      shade(counts.get(d) ?? 0, max),
                      isoDow(d) >= 6 && !counts.get(d) && "text-muted-foreground",
                      d === today && "ring-2 ring-red-500",
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                ) : (
                  <div key={d} />
                ),
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
