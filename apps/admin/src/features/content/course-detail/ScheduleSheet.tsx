"use client"

import { useEffect, useState } from "react"

import {
  Button,
  DatePicker,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  TimePicker,
} from "@bjj-academy/ui-kit/ui"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  publishedAt: string | null
  saving: boolean
  onSave: (date: Date | null, time: string) => void | Promise<void>
}

export function ScheduleSheet({
  open,
  onOpenChange,
  publishedAt,
  saving,
  onSave,
}: Props) {
  // Initial picker values come from the existing schedule when present;
  // fall back to "tomorrow at 09:00" so the form has a sensible default
  // without further clicks.
  const initialDate = publishedAt ? new Date(publishedAt) : null
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const [date, setDate] = useState<Date | null>(initialDate ?? tomorrow)
  const [time, setTime] = useState(
    initialDate
      ? `${String(initialDate.getHours()).padStart(2, "0")}:${String(initialDate.getMinutes()).padStart(2, "0")}`
      : "09:00",
  )

  // Re-sync when the parent's publishedAt changes (e.g. after saving).
  useEffect(() => {
    if (!open) return
    const next = publishedAt ? new Date(publishedAt) : tomorrow
    setDate(next)
    setTime(
      `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, publishedAt])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Запланировать публикацию</SheetTitle>
          <SheetDescription>
            Курс автоматически откроется ученикам в указанный момент — как
            отложенная публикация на YouTube. До этого он остаётся скрытым.
            Чтобы открыть сразу, нажмите «Опубликован».
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Дата</Label>
            <DatePicker value={date} onChange={setDate} className="w-full" />
          </div>
          <div className="space-y-1">
            <Label>Время</Label>
            <TimePicker value={time} onChange={setTime} />
          </div>
        </div>

        <SheetFooter className="mt-auto gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => void onSave(null, time)}
          >
            Снять расписание
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={saving || !date}
              onClick={() => void onSave(date, time)}
            >
              {saving ? "Сохраняем..." : "Сохранить"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
