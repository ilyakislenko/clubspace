"use client"

import { useState } from "react"

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  JOURNAL_PERIODS,
  PERIOD_LABEL,
  customRangeError,
  periodOf,
  presetRange,
  type JournalPeriod,
} from "./journal-view"

type Range = { from: string | null; to: string | null }

// The period of a money view in club-local days: «За 30 дней» (no dates, the
// dashboard's window) · «Этот месяц» · «Прошлый месяц» · «Выбрать даты…».
// Renders inside a `flex flex-wrap` toolbar; a bad custom range explains
// itself on a line of its own at the toolbar's end. Shared by «Платежи» and
// «Кто давал скидки».
export function PeriodPicker({
  id,
  value,
  today,
  onChange,
}: {
  // Prefix of the date inputs' ids (two pickers may share a page).
  id: string
  value: Range
  today: string
  onChange: (range: Range) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  // A linked custom range shows its dates in the inputs.
  const [draft, setDraft] = useState({ from: value.from ?? "", to: value.to ?? "" })
  const period: JournalPeriod = customOpen ? "custom" : periodOf(value, today)
  const error =
    period === "custom" && (draft.from || draft.to) ? customRangeError(draft.from, draft.to) : null

  const pick = (next: JournalPeriod) => {
    if (next === "custom") {
      // The inputs show only dates the view is using: the current range, or
      // empty until both are picked.
      setDraft({ from: value.from ?? "", to: value.to ?? "" })
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    const range = presetRange(next, today)
    onChange({ from: range?.from ?? null, to: range?.to ?? null })
  }

  const setDraftDate = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (!customRangeError(next.from, next.to)) onChange({ from: next.from, to: next.to })
  }

  return (
    <>
      <div className="w-44">
        <Select value={period} onValueChange={(v) => pick(v as JournalPeriod)}>
          <SelectTrigger aria-label="Период">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOURNAL_PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {period === "custom" && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
              С
            </Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={draft.from}
              max={draft.to || today}
              onChange={(e) => setDraftDate({ from: e.target.value })}
              className="h-9 w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
              По
            </Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(e) => setDraftDate({ to: e.target.value })}
              className="h-9 w-[160px]"
            />
          </div>
        </>
      )}
      {error && <p className="order-last basis-full text-sm text-destructive">{error}</p>}
    </>
  )
}
