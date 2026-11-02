"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import { inputCls } from "../../shared/lib/input-class"
import {
  filterTimezoneOptions,
  isValidTimezone,
  timezoneLabel,
  timezoneOptions,
} from "../../shared/lib/timezones"

// A club's time zone, picked by city («Томск (UTC+7)») with a search box
// instead of typing an IANA name. A zone that is not on the list (an older
// club, a city abroad) still shows as itself, and an exact IANA name typed into
// the search can be picked too.
export function TimezoneSelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id?: string
  value: string
  onChange: (zone: string) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const options = useMemo(() => timezoneOptions(), [])
  const matches = filterTimezoneOptions(options, query)
  const typedZone = query.trim()
  const offerTyped =
    typedZone.includes("/") &&
    isValidTimezone(typedZone) &&
    !options.some((o) => o.zone === typedZone)

  const pick = (zone: string) => {
    onChange(zone)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            inputCls,
            "flex w-full items-center justify-between gap-2 text-left disabled:opacity-60",
            className,
          )}
        >
          <span className="truncate">
            {value ? timezoneLabel(value) : "Выберите город"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2"
      >
        <input
          autoFocus
          className={cn(inputCls, "w-full")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            if (matches[0]) pick(matches[0].zone)
            else if (offerTyped) pick(typedZone)
          }}
          placeholder="Город или пояс, например Томск"
          aria-label="Поиск часового пояса"
        />
        <ul role="listbox" className="mt-2 max-h-64 overflow-y-auto">
          {matches.map((o) => (
            <li key={o.key}>
              <button
                type="button"
                role="option"
                aria-selected={o.zone === value}
                onClick={() => pick(o.zone)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span>{o.label}</span>
                {o.zone === value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            </li>
          ))}
          {offerTyped && (
            <li>
              <button
                type="button"
                onClick={() => pick(typedZone)}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                {timezoneLabel(typedZone)}
              </button>
            </li>
          )}
          {matches.length === 0 && !offerTyped && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              Ничего не нашлось. Попробуйте соседний крупный город или имя пояса
              вроде Asia/Tomsk.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
