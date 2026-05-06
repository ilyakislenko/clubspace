"use client"

import { Clock } from "lucide-react"
import * as React from "react"

import { cn } from "../util/utils"
import { Button } from "./button"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export type TimePickerProps = {
  /** "HH:MM" 24h string. Empty string is treated as "—" placeholder. */
  value: string
  onChange: (next: string) => void
  /** Step between selectable minutes (default: 5). */
  minuteStep?: number
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
)

const buildMinutes = (step: number): string[] => {
  const out: string[] = []
  for (let m = 0; m < 60; m += step) out.push(String(m).padStart(2, "0"))
  return out
}

const splitTime = (raw: string): { h: string; m: string } => {
  if (!raw) return { h: "", m: "" }
  const [h, m] = raw.split(":")
  return { h: h ?? "", m: m ?? "" }
}

export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  placeholder = "—",
  disabled,
  className,
  triggerClassName,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const minutes = React.useMemo(
    () => buildMinutes(minuteStep),
    [minuteStep],
  )
  const { h, m } = splitTime(value)

  // Snap minutes to the nearest step value when the input doesn't match —
  // protects against "19:07" coming back from the form when only :00/:05
  // are offered.
  const minuteForDisplay = React.useMemo(() => {
    if (!m) return ""
    if (minutes.includes(m)) return m
    const numeric = parseInt(m, 10)
    if (Number.isNaN(numeric)) return minutes[0]
    return minutes.reduce((best, candidate) => {
      const bestDiff = Math.abs(parseInt(best, 10) - numeric)
      const cDiff = Math.abs(parseInt(candidate, 10) - numeric)
      return cDiff < bestDiff ? candidate : best
    }, minutes[0])
  }, [m, minutes])

  const setHour = (next: string) => {
    onChange(`${next}:${minuteForDisplay || minutes[0]}`)
  }
  const setMinute = (next: string) => {
    onChange(`${h || "00"}:${next}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-[120px] justify-start text-left font-normal tabular-nums",
            !value && "text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <Clock className="mr-2 size-4" />
          {value || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-2">
          <Column items={HOURS} value={h} onPick={setHour} label="ч" />
          <span className="self-center text-muted-foreground">:</span>
          <Column
            items={minutes}
            value={minuteForDisplay}
            onPick={setMinute}
            label="мин"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Column({
  items,
  value,
  onPick,
  label,
}: {
  items: string[]
  value: string
  onPick: (next: string) => void
  label: string
}) {
  // Auto-scroll to the active row when the popover opens so a "19:00"
  // value doesn't bury the selection at the bottom of the list.
  const ref = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(
      "button[data-active='true']",
    )
    if (el) el.scrollIntoView({ block: "center" })
  }, [value])

  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        ref={ref}
        className="h-48 w-14 overflow-y-auto rounded-md border border-border"
      >
        {items.map((v) => {
          const active = v === value
          return (
            <button
              key={v}
              type="button"
              data-active={active}
              onClick={() => onPick(v)}
              className={cn(
                "w-full px-2 py-1 text-center text-sm tabular-nums hover:bg-muted",
                active && "bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}
