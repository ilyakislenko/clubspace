"use client"

import { CalendarClock } from "lucide-react"

import { countForm } from "@clubspace/ui-kit/brand"
import { cn } from "@clubspace/ui-kit/util"

import { pluralRu } from "../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { FALLBACK_COLOR, formatHm, formatRange, type DayRun } from "./calendar-helpers"
import type { CalendarItem } from "./calendar-items"
import { itemTooltip } from "./EventBlock"

/**
 * A week day's evening with more classes at once than fit side by side
 * (MAX_SIDE_BY_SIDE): one card over the run's time span listing its classes by
 * start time — readable where five 25 px slivers were not. A row opens the
 * class; moving one is done from its panel or the day view.
 */
export function RunList({
  run,
  style,
  onOpenItem,
}: {
  run: DayRun<CalendarItem>
  style: { top: number; height: number }
  onOpenItem: (item: CalendarItem) => void
}) {
  const vocabulary = useVocabulary()
  const items = run.lanes
    .flat()
    .sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title, "ru"))
  const label = `${items.length} ${countForm(items.length, vocabulary.session, pluralRu)}, ${formatRange(run.startMin, run.endMin)}`

  return (
    <ul
      data-calendar-run
      aria-label={label}
      className="absolute inset-x-0.5 z-10 overflow-y-auto rounded-md border border-border bg-card py-0.5 shadow-sm"
      style={style}
    >
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            data-calendar-block={it.key}
            title={itemTooltip(it)}
            onClick={() => onOpenItem(it)}
            className={cn(
              "flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-left text-xs leading-tight hover:bg-accent",
              it.cancelled && "text-muted-foreground",
            )}
          >
            {it.kind === "event" ? (
              <CalendarClock aria-hidden className="size-3 shrink-0 opacity-70" />
            ) : (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: it.color ?? FALLBACK_COLOR }}
              />
            )}
            <span className="shrink-0 font-medium tabular-nums">{formatHm(it.startMin)}</span>
            <span className={cn("truncate", it.cancelled && "line-through")}>{it.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
