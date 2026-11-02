"use client"

import { AlertTriangle, ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@clubspace/ui-kit/ui"

import { pluralRu } from "../../../shared/lib/plural-ru"
import { slotLabel } from "./calendar-format"
import { dayMonth, DOW_SHORT, formatRange, isoDow, type Conflict } from "./calendar-helpers"
import type { CalendarItem, ClassItem } from "./calendar-items"
import { ConflictList } from "./ConflictList"
import type { DragTarget } from "./use-grid-drag"
import { useVocabulary } from "../../../shared/lib/vocabulary"

export type MoveScope = "one" | "following"

type Props = {
  move: { item: ClassItem; target: DragTarget } | null
  conflicts: Conflict<CalendarItem>[]
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (scope: MoveScope, notify: boolean) => void
}

/**
 * The question every drag / resize ends with: move only this class (a one-off
 * for that date) or change the weekly slot from this date on.
 */
export function MoveDialog({ move, conflicts, busy, error, onCancel, onConfirm }: Props) {
  const vocabulary = useVocabulary()
  const [notify, setNotify] = useState(true)
  useEffect(() => {
    if (move) setNotify(true)
  }, [move])

  if (!move) return null
  const { item, target } = move
  const s = item.session
  const resizeOnly = target.date === item.date && target.startMin === item.startMin
  const weekly = s.recurring
  const booked = s.booking?.booked ?? 0
  const waitlist = s.booking?.waitlist ?? 0
  const sameWeekday = isoDow(target.date) === isoDow(item.date)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-w-xl" data-calendar-move-dialog>
        <DialogHeader>
          <DialogTitle>{resizeOnly ? "Изменить длительность" : "Перенести занятие"}</DialogTitle>
          <DialogDescription>«{item.title}»</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground line-through decoration-muted-foreground/60">
            {slotLabel(item)}
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="font-semibold">{slotLabel(target)}</span>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          {s.booking ? (
            <p>
              {booked + waitlist > 0
                ? `${booked} ${pluralRu(booked, "запись", "записи", "записей")}${
                    waitlist > 0 ? ` и ${waitlist} в листе ожидания` : ""
                  } переедут вместе с занятием.`
                : "На это занятие пока никто не записан."}
            </p>
          ) : (
            <p>Состав группы не меняется.</p>
          )}
          {weekly ? (
            <p>
              «Это и все следующие» — с {dayMonth(item.date)} занятие по{" "}
              {DOW_SHORT[isoDow(item.date)].toLowerCase()} {formatRange(item.startMin, item.endMin)} станет{" "}
              {sameWeekday ? "" : `по ${DOW_SHORT[isoDow(target.date)].toLowerCase()} `}
              {formatRange(target.startMin, target.endMin)} каждую неделю. Прошедшие занятия
              не изменятся.
            </p>
          ) : (
            <p>Это разовое занятие — меняется только оно.</p>
          )}
        </div>

        <ConflictList conflicts={conflicts} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Уведомить учеников и {vocabulary.coach.acc}
        </label>

        {error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          {weekly && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onConfirm("following", notify)}
              data-move-scope="following"
            >
              Это и все следующие
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => onConfirm("one", notify)}
            data-move-scope="one"
          >
            {busy ? "Сохраняем…" : "Только это занятие"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
