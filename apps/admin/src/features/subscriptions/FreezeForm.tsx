"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import {
  addDaysYmd,
  extendedEndDate,
  formatDayRange,
  FREEZE_DAY_PRESETS,
  FREEZE_REASON_PRESETS,
  MAX_FREEZE_DAYS,
  todayYmd,
} from "./freeze-utils"

export type FreezeFormValues = {
  days: number
  // Omitted when it is the browser's today, so the server uses the club's
  // own today (a club can sit in another timezone than this browser).
  fromDate: string | undefined
  reason: string | undefined
}

// Days / start day / reason for freezing an abonement. Shared by the direct
// admin freeze and (later) approving a member's request.
export function FreezeForm({
  endDate,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  endDate: string | null
  initial?: Partial<{ days: number; fromDate: string; reason: string | null }>
  submitLabel: string
  busy: boolean
  onSubmit: (values: FreezeFormValues) => void
  onCancel: () => void
}) {
  const today = todayYmd(new Date())
  const [daysText, setDaysText] = useState(String(initial?.days ?? 7))
  const [fromDate, setFromDate] = useState(initial?.fromDate ?? today)
  const [reason, setReason] = useState(initial?.reason ?? "")

  const days = parseIntInput(daysText, { min: 1, max: MAX_FREEZE_DAYS })
  const fromValid = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && fromDate >= today
  const valid = days !== null && fromValid

  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">Сколько дней</span>
        {FREEZE_DAY_PRESETS.map((n) => (
          <Button
            key={n}
            size="sm"
            variant={days === n ? "default" : "outline"}
            onClick={() => setDaysText(String(n))}
          >
            {n} дн.
          </Button>
        ))}
        <input
          className={`${inputCls} w-24`}
          inputMode="numeric"
          value={daysText}
          onChange={(e) => setDaysText(e.target.value)}
        />
      </div>
      {days === null && (
        <p className="text-xs text-destructive">
          Введите число дней от 1 до {MAX_FREEZE_DAYS}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">С какого дня</span>
        <input
          className={inputCls}
          type="date"
          min={today}
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
      </div>
      {!fromValid && (
        <p className="text-xs text-destructive">
          Дата начала не может быть в прошлом
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">
          Причина (увидит участник)
        </span>
        {FREEZE_REASON_PRESETS.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={reason === r ? "default" : "outline"}
            onClick={() => setReason(r)}
          >
            {r}
          </Button>
        ))}
        <input
          className={`${inputCls} min-w-56 flex-1`}
          maxLength={200}
          placeholder="Например, травма колена"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {valid && (
        <p className="text-xs text-muted-foreground">
          Заморозка {formatDayRange(fromDate, addDaysYmd(fromDate, days - 1))}.
          {endDate
            ? ` Абонемент продлится до ${extendedEndDate(endDate, days).toLocaleDateString("ru-RU")}`
            : ""}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          disabled={!valid || busy}
          onClick={() =>
            valid &&
            onSubmit({
              days,
              fromDate: fromDate === today ? undefined : fromDate,
              reason: reason.trim() || undefined,
            })
          }
        >
          {busy ? "…" : submitLabel}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  )
}
