"use client"

import { CalendarClock, MapPin, Repeat2, UserRound, UserRoundCog, Users } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { cap } from "@clubspace/ui-kit/brand"

import {
  Button,
  DatePicker,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
  TimePicker,
} from "@clubspace/ui-kit/ui"

import {
  createGroupException,
  deleteGroupException,
  type GroupScheduleException,
  type GroupSummary,
} from "../../../shared/api/groups"
import { errorMessage } from "../../../shared/lib/error-message"
import { pluralRu } from "../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { DirectionChip } from "../../directions/DirectionChip"
import { ClassAttendancePanel } from "../ClassAttendancePanel"
import { ClassBookingPanel } from "../ClassBookingPanel"
import { ClassSubstitutionPanel } from "../ClassSubstitutionPanel"
import { personName, slotLabel } from "./calendar-format"
import { dayLabel, formatHm, minutesOf, wallClock } from "./calendar-helpers"
import { fillLabel, type CalendarItem, type ClassItem } from "./calendar-items"
import { substitutionLabel } from "./substitution"
import type { DragTarget } from "./use-grid-drag"

const ymdToLocalDate = (ymd: string): Date => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d)
}

const localDateToYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// The cancellation behind a cancelled class: a one-day exception of this slot
// can be undone here; a vacation of the whole group is edited in the group.
export const cancellationOf = (
  group: GroupSummary | undefined,
  item: ClassItem,
): GroupScheduleException | null =>
  group?.exceptions.find(
    (e) =>
      (e.slotId === null || e.slotId === item.session.slotId) &&
      e.fromDate <= item.date &&
      e.untilDate >= item.date,
  ) ?? null

type Props = {
  workspaceId: string
  item: CalendarItem | null
  group: GroupSummary | undefined
  onClose: () => void
  onMoveRequest: (item: ClassItem, target: DragTarget) => void
  onCancelled: (item: ClassItem, exception: GroupScheduleException) => void
  onRestored: () => void
  // Substitution / bookings changed — the calendar refreshes.
  onChanged: () => void
  // The viewer may change this class's group (also when the class is cancelled).
  canManage: boolean
}

/** Side panel of a class (or a club event): details, move, cancel, roster. */
export function ClassDetailsSheet(props: Props) {
  const { item, onClose } = props
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md" data-calendar-details>
        {item?.kind === "class" && <ClassDetails {...props} item={item} />}
        {item?.kind === "event" && <EventDetails item={item} workspaceId={props.workspaceId} />}
      </SheetContent>
    </Sheet>
  )
}

function Row({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ClassDetails({
  workspaceId,
  item,
  group,
  onMoveRequest,
  onCancelled,
  onRestored,
  onChanged,
  canManage,
}: Props & { item: ClassItem }) {
  const s = item.session
  const vocabulary = useVocabulary()
  const [date, setDate] = useState(item.date)
  const [time, setTime] = useState(formatHm(item.startMin))
  const [duration, setDuration] = useState(String(item.endMin - item.startMin))
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDate(item.date)
    setTime(formatHm(item.startMin))
    setDuration(String(item.endMin - item.startMin))
    setCancelOpen(false)
    setReason("")
    setError(null)
    // A refresh rebuilds the item object; reset only when the class itself changes.
  }, [item.key, item.date, item.startMin, item.endMin])

  const sub = substitutionLabel(s)
  const fill = fillLabel(s)
  const cancellation = s.cancelled ? cancellationOf(group, item) : null
  const restorable =
    !!cancellation &&
    cancellation.slotId !== null &&
    cancellation.fromDate === cancellation.untilDate
  const startMin = minutesOf(time || "00:00")
  const durationMin = Number(duration)
  const moveValid =
    Number.isInteger(durationMin) && durationMin >= 5 && startMin + durationMin <= 24 * 60
  const changed =
    date !== item.date || startMin !== item.startMin || startMin + durationMin !== item.endMin
  const movedFrom = s.rescheduledFrom
    ? wallClock(s.rescheduledFrom.startAt, s.timezone)
    : null

  const cancelClass = async () => {
    setBusy(true)
    setError(null)
    try {
      const exception = await createGroupException({
        workspaceId,
        groupId: s.groupId,
        data: {
          slotId: s.slotId,
          fromDate: item.date,
          untilDate: item.date,
          reason: reason.trim() || null,
        },
      })
      onCancelled(item, exception)
    } catch (e) {
      setError(errorMessage(e, `Не удалось отменить ${vocabulary.session.acc}`))
    } finally {
      setBusy(false)
    }
  }

  const restoreClass = async () => {
    if (!cancellation) return
    setBusy(true)
    setError(null)
    try {
      await deleteGroupException({
        workspaceId,
        groupId: s.groupId,
        exceptionId: cancellation.id,
      })
      onRestored()
    } catch (e) {
      setError(errorMessage(e, `Не удалось вернуть ${vocabulary.session.acc}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{s.group.name}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-1.5">
            <DirectionChip direction={s.group.direction} />
            {s.booking && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
                Запись на {vocabulary.session.acc}
              </span>
            )}
            {!s.recurring && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Разовое
              </span>
            )}
            {s.cancelled && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                Отменено
              </span>
            )}
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-2.5">
        <Row icon={CalendarClock}>
          <span className="first-letter:uppercase">{slotLabel(item)}</span>
        </Row>
        {s.rescheduledFrom && movedFrom && (
          <Row icon={Repeat2}>
            <span className="text-sky-700 dark:text-sky-300">
              Перенесено с {dayLabel(s.rescheduledFrom.sessionDate)}, {formatHm(movedFrom.minutes)}
            </span>
          </Row>
        )}
        {s.cancelled && s.cancellationReason && (
          <Row icon={CalendarClock}>
            <span className="text-muted-foreground">Причина: {s.cancellationReason}</span>
          </Row>
        )}
        <Row icon={MapPin}>{s.group.gym?.name ?? "Зал не указан"}</Row>
        <Row icon={UserRound}>{personName(s.group.coach)}</Row>
        {sub && (
          <Row icon={UserRoundCog}>
            <span className="font-medium text-amber-800 dark:text-amber-300">{sub}</span>
          </Row>
        )}
        <Row icon={Users}>
          {s.booking ? (
            <span>
              Записано <b className="tabular-nums">{fill}</b>
              {s.booking.waitlist > 0 && ` · ${s.booking.waitlist} в листе ожидания`}
            </span>
          ) : (
            <span>
              {group ? `${group.memberCount} ${pluralRu(group.memberCount, "ученик", "ученика", "учеников")} в группе` : "Постоянная группа"}
              {s.bookedGuests > 0 &&
                ` · +${s.bookedGuests} ${pluralRu(s.bookedGuests, "гость", "гостя", "гостей")}`}
            </span>
          )}
        </Row>
      </div>

      {!s.cancelled && (
        <ClassSubstitutionPanel
          workspaceId={workspaceId}
          slotId={s.slotId}
          sessionDate={item.date}
          onChanged={onChanged}
        />
      )}

      {s.booking && (
        <ClassBookingPanel
          key={`booking:${item.key}`}
          workspaceId={workspaceId}
          slotId={s.slotId}
          sessionDate={item.date}
          onChanged={onChanged}
        />
      )}

      {!s.cancelled && (
        <ClassAttendancePanel
          key={`attendance:${item.key}`}
          workspaceId={workspaceId}
          session={{ kind: "scheduled", slotId: s.slotId, sessionDate: item.date }}
        />
      )}

      {item.editable && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="text-sm font-medium">Перенести или изменить длительность</div>
          <div className="grid gap-1.5">
            <Label>Дата</Label>
            <DatePicker
              value={ymdToLocalDate(date)}
              onChange={(d) => d && setDate(localDateToYmd(d))}
              formatValue={(d) => dayLabel(localDateToYmd(d))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Начало</Label>
              <TimePicker value={time} onChange={setTime} minuteStep={15} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="details-duration">Минут</Label>
              <Input
                id="details-duration"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <Button
            className="w-full"
            disabled={!changed || !moveValid}
            onClick={() =>
              onMoveRequest(item, { date, startMin, endMin: startMin + durationMin })
            }
          >
            Перенести…
          </Button>
          <p className="text-xs text-muted-foreground">
            {cap(vocabulary.session.acc)} можно и просто перетащить в календаре, а длительность — потянуть за нижний край.
          </p>
        </div>
      )}

      {item.editable &&
        (cancelOpen ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 p-3">
            <Label htmlFor="details-cancel-reason">Причина (увидят ученики)</Label>
            <Textarea
              id="details-cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: праздничный день"
            />
            {s.booking && (
              <p className="text-xs text-muted-foreground">
                Записи на {vocabulary.session.acc} отменятся без списания, ученики получат уведомление.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" disabled={busy} onClick={() => void cancelClass()}>
                {busy ? "…" : `Отменить ${vocabulary.session.acc}`}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setCancelOpen(false)}>
                Не отменять
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            Отменить {vocabulary.session.acc}
          </Button>
        ))}

      {s.cancelled && group && canManage && (
        restorable ? (
          <Button variant="outline" disabled={busy} onClick={() => void restoreClass()}>
            Вернуть {vocabulary.session.acc}
          </Button>
        ) : (
          cancellation && (
            <p className="text-xs text-muted-foreground">
              Отмена задана для всей группы или на период — её меняют в разделе «Группы и
              расписание».
            </p>
          )
        )
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  )
}

function EventDetails({
  item,
  workspaceId,
}: {
  item: Extract<CalendarItem, { kind: "event" }>
  workspaceId: string
}) {
  const e = item.event
  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{e.title}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Событие клуба</span>
            <DirectionChip direction={e.direction} />
          </div>
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-2.5">
        <Row icon={CalendarClock}>
          <span className="first-letter:uppercase">{slotLabel(item)}</span>
        </Row>
        <Row icon={MapPin}>{e.gym?.name ?? "Весь клуб"}</Row>
        {e.coach && <Row icon={UserRound}>{personName(e.coach)}</Row>}
      </div>
      {e.description && <p className="whitespace-pre-line text-sm">{e.description}</p>}
      <Link
        href={`/workspace/${workspaceId}/events`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Открыть «События»
      </Link>
    </>
  )
}
