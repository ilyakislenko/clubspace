"use client"

import { useState, type FormEvent } from "react"

import {
  Button,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimePicker,
} from "@bjj-academy/ui-kit/ui"

import {
  createGroupException,
  createGroupSlot,
  deleteGroupException,
  deleteGroupSlot,
  type GroupScheduleException,
  type GroupScheduleSlot,
  type GroupSummary,
} from "../../shared/api/groups"

const DAY_LABELS: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
}

const DAY_LABELS_LONG: Record<number, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье",
}

const formatDuration = (min: number): string => {
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
}

// Format a calendar Date to YYYY-MM-DD using its LOCAL components. We
// intentionally don't go through toISOString — that would shift to UTC
// and can roll over to the previous day for users east of UTC late at
// night.
const dateToIso = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Props = {
  workspaceId: string
  group: GroupSummary
  onChanged: () => void | Promise<void>
}

export function GroupScheduleBlock({ workspaceId, group, onChanged }: Props) {
  const [showSlotForm, setShowSlotForm] = useState(false)
  const [showExceptionForm, setShowExceptionForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busySlotId, setBusySlotId] = useState<string | null>(null)
  const [busyExceptionId, setBusyExceptionId] = useState<string | null>(null)

  const slots = [...group.slots].sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek ||
      a.startTime.localeCompare(b.startTime),
  )
  const exceptions = [...group.exceptions].sort((a, b) =>
    a.fromDate.localeCompare(b.fromDate),
  )

  const handleDeleteSlot = async (slot: GroupScheduleSlot) => {
    if (
      !window.confirm(
        `Удалить слот ${DAY_LABELS[slot.dayOfWeek]} ${slot.startTime}?`,
      )
    ) {
      return
    }
    setBusySlotId(slot.id)
    setError(null)
    try {
      await deleteGroupSlot({
        workspaceId,
        groupId: group.id,
        slotId: slot.id,
      })
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить слот")
    } finally {
      setBusySlotId(null)
    }
  }

  const handleDeleteException = async (e: GroupScheduleException) => {
    if (!window.confirm("Снять отмену?")) return
    setBusyExceptionId(e.id)
    setError(null)
    try {
      await deleteGroupException({
        workspaceId,
        groupId: group.id,
        exceptionId: e.id,
      })
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось снять отмену")
    } finally {
      setBusyExceptionId(null)
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs uppercase text-muted-foreground">
            Расписание ({slots.length})
          </span>
          {!showSlotForm && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowSlotForm(true)}
            >
              + Слот
            </Button>
          )}
        </div>

        {slots.length === 0 && !showSlotForm ? (
          <p className="text-xs text-muted-foreground">
            Слоты не заданы — добавь день, время и длительность.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {slots.map((slot) => (
              <li
                key={slot.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="w-12 font-medium tabular-nums">
                  {DAY_LABELS[slot.dayOfWeek]}
                </span>
                <span className="tabular-nums">{slot.startTime}</span>
                <span className="text-muted-foreground">
                  · {formatDuration(slot.durationMin)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void handleDeleteSlot(slot)}
                  disabled={busySlotId === slot.id}
                >
                  {busySlotId === slot.id ? "..." : "Удалить"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {showSlotForm && (
          <SlotForm
            workspaceId={workspaceId}
            groupId={group.id}
            onCancel={() => setShowSlotForm(false)}
            onCreated={async () => {
              setShowSlotForm(false)
              await onChanged()
            }}
            onError={setError}
          />
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs uppercase text-muted-foreground">
            Отмены и отпуска ({exceptions.length})
          </span>
          {!showExceptionForm && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowExceptionForm(true)}
            >
              + Отмена
            </Button>
          )}
        </div>

        {exceptions.length === 0 && !showExceptionForm ? (
          <p className="text-xs text-muted-foreground">
            Без активных отмен.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {exceptions.map((e) => {
              const sameDay = e.fromDate === e.untilDate
              const slot = e.slotId
                ? group.slots.find((s) => s.id === e.slotId)
                : null
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <span className="tabular-nums">
                    {sameDay ? e.fromDate : `${e.fromDate} → ${e.untilDate}`}
                  </span>
                  <span className="text-muted-foreground">
                    ·{" "}
                    {slot
                      ? `только ${DAY_LABELS[slot.dayOfWeek]} ${slot.startTime}`
                      : "вся группа"}
                  </span>
                  {e.reason && (
                    <span className="truncate text-muted-foreground">
                      · {e.reason}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => void handleDeleteException(e)}
                    disabled={busyExceptionId === e.id}
                  >
                    {busyExceptionId === e.id ? "..." : "Снять"}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {showExceptionForm && (
          <ExceptionForm
            workspaceId={workspaceId}
            groupId={group.id}
            slots={slots}
            onCancel={() => setShowExceptionForm(false)}
            onCreated={async () => {
              setShowExceptionForm(false)
              await onChanged()
            }}
            onError={setError}
          />
        )}
      </div>
    </div>
  )
}

function SlotForm({
  workspaceId,
  groupId,
  onCancel,
  onCreated,
  onError,
}: {
  workspaceId: string
  groupId: string
  onCancel: () => void
  onCreated: () => void | Promise<void>
  onError: (msg: string) => void
}) {
  const [dayOfWeek, setDayOfWeek] = useState<number>(2)
  const [startTime, setStartTime] = useState("19:00")
  const [durationMin, setDurationMin] = useState(90)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await createGroupSlot({
        workspaceId,
        groupId,
        data: { dayOfWeek, startTime, durationMin },
      })
      await onCreated()
    } catch (err) {
      onError(err instanceof Error ? err.message : "Не удалось добавить слот")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
    >
      <div className="flex-shrink-0">
        <Label className="text-xs">День</Label>
        <Select
          value={String(dayOfWeek)}
          onValueChange={(v) => setDayOfWeek(parseInt(v, 10))}
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <SelectItem key={d} value={String(d)}>
                {DAY_LABELS_LONG[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-shrink-0 space-y-1">
        <Label className="text-xs">Начало</Label>
        <TimePicker value={startTime} onChange={setStartTime} />
      </div>
      <div className="flex-shrink-0">
        <Label className="text-xs">Минут</Label>
        <Input
          type="number"
          min={5}
          max={1440}
          step={5}
          value={durationMin}
          onChange={(e) => setDurationMin(parseInt(e.target.value, 10) || 0)}
          className="h-9 w-[100px]"
          required
        />
      </div>
      <div className="ml-auto flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Сохраняем..." : "Добавить"}
        </Button>
      </div>
    </form>
  )
}

function ExceptionForm({
  workspaceId,
  groupId,
  slots,
  onCancel,
  onCreated,
  onError,
}: {
  workspaceId: string
  groupId: string
  slots: GroupScheduleSlot[]
  onCancel: () => void
  onCreated: () => void | Promise<void>
  onError: (msg: string) => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [fromDate, setFromDate] = useState<Date | null>(today)
  const [untilDate, setUntilDate] = useState<Date | null>(today)
  // "all" = whole group cancelled in the range; otherwise the slotId.
  const [scope, setScope] = useState<string>("all")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!fromDate || !untilDate) {
      onError("Укажи даты диапазона")
      return
    }
    if (fromDate.getTime() > untilDate.getTime()) {
      onError("Дата начала должна быть раньше или равна дате окончания")
      return
    }
    setSubmitting(true)
    try {
      await createGroupException({
        workspaceId,
        groupId,
        data: {
          fromDate: dateToIso(fromDate),
          untilDate: dateToIso(untilDate),
          slotId: scope === "all" ? null : scope,
          reason: reason.trim() || null,
        },
      })
      await onCreated()
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Не удалось добавить отмену",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2"
    >
      <div>
        <Label className="text-xs">С (включительно)</Label>
        <DatePicker
          value={fromDate}
          onChange={(d) => {
            setFromDate(d)
            // Auto-bump untilDate to keep the range valid when the user
            // shifts start past the current end.
            if (d && untilDate && untilDate.getTime() < d.getTime()) {
              setUntilDate(d)
            }
          }}
          className="w-full"
        />
      </div>
      <div>
        <Label className="text-xs">По (включительно)</Label>
        <DatePicker
          value={untilDate}
          onChange={setUntilDate}
          className="w-full"
        />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-xs">Что отменяется</Label>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Вся группа (например, отпуск тренера)
            </SelectItem>
            {slots.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                Только {DAY_LABELS[s.dayOfWeek]} {s.startTime}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label className="text-xs">Причина (опционально)</Label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Отпуск, праздники, заменю позже…"
          className="h-9"
        />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Сохраняем..." : "Добавить"}
        </Button>
      </div>
    </form>
  )
}
