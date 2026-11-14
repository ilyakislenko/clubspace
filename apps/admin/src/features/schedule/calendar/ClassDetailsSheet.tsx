"use client"

import { CalendarClock, MapPin, Repeat2, UserRound, UserRoundCog, Users } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { agree, cap } from "@clubspace/ui-kit/brand"

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
  deleteGroupSlot,
  getGroup,
  updateGroupSlot,
  type GroupDetails,
  type GroupScheduleException,
  type GroupSummary,
} from "../../../shared/api/groups"
import { errorMessage } from "../../../shared/lib/error-message"
import { formatYmd } from "../../../shared/lib/format-ymd"
import { parseIntInput } from "../../../shared/lib/parse-int-input"
import { pluralRu } from "../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../shared/ui/confirm-dialog"
import { DirectionChip } from "../../directions/DirectionChip"
import { ClassAttendancePanel } from "../ClassAttendancePanel"
import { ClassBookingPanel } from "../ClassBookingPanel"
import { ClassSubstitutionPanel } from "../ClassSubstitutionPanel"
import { personName, slotLabel } from "./calendar-format"
import { dayLabel, dayMonth, formatHm, minutesOf, wallClock } from "./calendar-helpers"
import { fillLabel, type CalendarItem, type ClassItem } from "./calendar-items"
import { substitutionLabel } from "./substitution"
import type { DragTarget } from "./use-grid-drag"

const ymdToLocalDate = (ymd: string): Date => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d)
}

const localDateToYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// The calendar day before `ymd`.
export const dayBefore = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

// The cancellation behind a cancelled class: an exception of the whole group
// or of this slot covering its date.
export const cancellationOf = (
  exceptions: readonly GroupScheduleException[],
  item: ClassItem,
): GroupScheduleException | null =>
  exceptions.find(
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
  // The weekly class itself changed (ended, places): refresh, close, say what happened.
  onScheduleChanged: (message: string) => void
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

type CancelScope = "one" | "period"

function ClassDetails({
  workspaceId,
  item,
  group,
  onMoveRequest,
  onCancelled,
  onRestored,
  onChanged,
  onScheduleChanged,
  canManage,
}: Props & { item: ClassItem }) {
  const s = item.session
  const vocabulary = useVocabulary()
  const session = vocabulary.session
  const [date, setDate] = useState(item.date)
  const [time, setTime] = useState(formatHm(item.startMin))
  const [duration, setDuration] = useState(String(item.endMin - item.startMin))
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelScope, setCancelScope] = useState<CancelScope>("one")
  const [periodFrom, setPeriodFrom] = useState(item.date)
  const [periodUntil, setPeriodUntil] = useState(item.date)
  const [periodWholeGroup, setPeriodWholeGroup] = useState(true)
  const [reason, setReason] = useState("")
  const [endOpen, setEndOpen] = useState(false)
  const [capacityDraft, setCapacityDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Slots and exceptions of the class's group, for whoever may change it.
  const [details, setDetails] = useState<GroupDetails | null>(null)

  useEffect(() => {
    setDate(item.date)
    setTime(formatHm(item.startMin))
    setDuration(String(item.endMin - item.startMin))
    setCancelOpen(false)
    setCancelScope("one")
    setPeriodFrom(item.date)
    setPeriodUntil(item.date)
    setPeriodWholeGroup(true)
    setReason("")
    setEndOpen(false)
    setError(null)
    // A refresh rebuilds the item object; reset only when the class itself changes.
  }, [item.key, item.date, item.startMin, item.endMin])

  useEffect(() => {
    if (!canManage) {
      setDetails(null)
      return
    }
    let alive = true
    getGroup({ workspaceId, groupId: s.groupId })
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setDetails(null))
    return () => {
      alive = false
    }
    // Re-read when the class gets cancelled or restored.
  }, [workspaceId, s.groupId, canManage, s.cancelled])

  const slot = details?.slots.find((x) => x.id === s.slotId) ?? null
  useEffect(() => {
    setCapacityDraft(slot?.capacity == null ? "" : String(slot.capacity))
  }, [slot?.id, slot?.capacity])

  const sub = substitutionLabel(s)
  const fill = fillLabel(s)
  const cancellation = s.cancelled && details ? cancellationOf(details.exceptions, item) : null
  const singleDay =
    !!cancellation && cancellation.slotId !== null && cancellation.fromDate === cancellation.untilDate
  const startMin = minutesOf(time || "00:00")
  const durationMin = Number(duration)
  const moveValid =
    Number.isInteger(durationMin) && durationMin >= 5 && startMin + durationMin <= 24 * 60
  const changed =
    date !== item.date || startMin !== item.startMin || startMin + durationMin !== item.endMin
  const movedFrom = s.rescheduledFrom
    ? wallClock(s.rescheduledFrom.startAt, s.timezone)
    : null
  const periodValid = periodFrom <= periodUntil
  const parsedCapacity = capacityDraft.trim() ? parseIntInput(capacityDraft, { min: 1, max: 1000 }) : null
  const capacityInvalid = capacityDraft.trim() !== "" && parsedCapacity === null
  const capacityChanged = !!slot && parsedCapacity !== slot.capacity && !capacityInvalid

  const act = async (action: () => Promise<void>, failure: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e, failure))
    } finally {
      setBusy(false)
    }
  }

  const cancelClass = () =>
    act(async () => {
      const period = cancelScope === "period"
      const exception = await createGroupException({
        workspaceId,
        groupId: s.groupId,
        data: {
          slotId: period && periodWholeGroup ? null : s.slotId,
          fromDate: period ? periodFrom : item.date,
          untilDate: period ? periodUntil : item.date,
          reason: reason.trim() || null,
        },
      })
      onCancelled(item, exception)
    }, `Не удалось отменить ${session.acc}`)

  const restore = () =>
    act(async () => {
      if (!cancellation) return
      if (
        !singleDay &&
        !(await confirmDialog({
          title: "Снять отмену?",
          description: `С ${dayMonth(cancellation.fromDate)} по ${dayMonth(cancellation.untilDate)} вернутся все ${session.nomPl} этого периода.`,
          confirmLabel: "Снять отмену",
        }))
      ) {
        return
      }
      await deleteGroupException({ workspaceId, groupId: s.groupId, exceptionId: cancellation.id })
      onRestored()
    }, `Не удалось вернуть ${session.acc}`)

  // Ends the weekly class from this date. Past classes stay in the history;
  // a series that only starts on (or after) this date is removed outright.
  const endSeries = () =>
    act(async () => {
      if (!slot) return
      if (slot.effectiveFrom !== null && slot.effectiveFrom >= item.date) {
        await deleteGroupSlot({ workspaceId, groupId: s.groupId, slotId: slot.id })
      } else {
        await updateGroupSlot({
          workspaceId,
          groupId: s.groupId,
          slotId: slot.id,
          data: { effectiveUntil: dayBefore(item.date) },
        })
      }
      onScheduleChanged(
        `«${s.group.name}» ${dayLabel(item.date)} и дальше в ${formatHm(item.startMin)} больше не проводится`,
      )
    }, "Не удалось изменить расписание")

  const saveCapacity = () =>
    act(async () => {
      if (!slot) return
      await updateGroupSlot({
        workspaceId,
        groupId: s.groupId,
        slotId: slot.id,
        data: { capacity: parsedCapacity },
      })
      onScheduleChanged(
        parsedCapacity === null
          ? "Мест — как у группы"
          : `Мест на ${session.prep} в это время: ${parsedCapacity}`,
      )
    }, "Не удалось изменить число мест")

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{s.group.name}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-1.5">
            <DirectionChip direction={s.group.direction} />
            {s.booking && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
                Запись на {session.acc}
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
        <Link
          href={`/workspace/${workspaceId}/groups/${s.groupId}`}
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Карточка группы
        </Link>
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
            {cap(session.acc)} можно и просто перетащить в календаре, а длительность — потянуть за нижний край.
          </p>
        </div>
      )}

      {item.editable && s.recurring && s.booking && slot && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label htmlFor="details-slot-capacity">
            Мест на {agree(session, "каждой", "каждом")} {session.prep} в это время
          </Label>
          <div className="flex gap-2">
            <Input
              id="details-slot-capacity"
              inputMode="numeric"
              value={capacityDraft}
              onChange={(e) => setCapacityDraft(e.target.value)}
              placeholder={
                details?.capacity == null ? "как у группы: без ограничения" : `как у группы: ${details.capacity}`
              }
              aria-invalid={capacityInvalid}
            />
            <Button variant="outline" disabled={busy || !capacityChanged} onClick={() => void saveCapacity()}>
              Для всех недель
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Пусто — как у группы. Только на одну дату — в блоке записи выше.
          </p>
        </div>
      )}

      {item.editable &&
        (cancelOpen ? (
          <div className="space-y-3 rounded-lg border border-destructive/30 p-3">
            <div role="radiogroup" aria-label="Что отменить" className="space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cancel-scope"
                  checked={cancelScope === "one"}
                  onChange={() => setCancelScope("one")}
                />
                Только {agree(session, "эту", "это")} {session.acc}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cancel-scope"
                  checked={cancelScope === "period"}
                  onChange={() => setCancelScope("period")}
                />
                Перерыв на несколько дней (отпуск, праздники)
              </label>
            </div>
            {cancelScope === "period" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label>С</Label>
                    <DatePicker
                      value={ymdToLocalDate(periodFrom)}
                      onChange={(d) => {
                        if (!d) return
                        const ymd = localDateToYmd(d)
                        setPeriodFrom(ymd)
                        if (periodUntil < ymd) setPeriodUntil(ymd)
                      }}
                      formatValue={(d) => formatYmd(localDateToYmd(d))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>По</Label>
                    <DatePicker
                      value={ymdToLocalDate(periodUntil)}
                      onChange={(d) => d && setPeriodUntil(localDateToYmd(d))}
                      formatValue={(d) => formatYmd(localDateToYmd(d))}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={periodWholeGroup}
                    onChange={(e) => setPeriodWholeGroup(e.target.checked)}
                  />
                  Все {session.nomPl} группы, а не только в {formatHm(item.startMin)}
                </label>
                {!periodValid && (
                  <p className="text-xs text-destructive">Дата начала позже даты окончания</p>
                )}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="details-cancel-reason">Причина (увидят ученики)</Label>
              <Textarea
                id="details-cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например: праздничный день"
              />
            </div>
            {s.booking && (
              <p className="text-xs text-muted-foreground">
                Записи на {session.acc} отменятся без списания, ученики получат уведомление.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={busy || (cancelScope === "period" && !periodValid)}
                onClick={() => void cancelClass()}
              >
                {busy ? "…" : "Отменить"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setCancelOpen(false)}>
                Не отменять
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
            Отменить {session.acc}…
          </Button>
        ))}

      {item.editable &&
        s.recurring &&
        slot &&
        (endOpen ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm">
            <p>
              {cap(session.nomPl)} «{s.group.name}» в {formatHm(item.startMin)} по этому дню недели
              больше не будут проводиться, начиная с {dayLabel(item.date)}. Прошедшие останутся в
              истории.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={busy} onClick={() => void endSeries()}>
                {busy ? "…" : "Убрать из расписания"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setEndOpen(false)}>
                Оставить
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEndOpen(true)}
            className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
          >
            Убрать из расписания с этой даты…
          </button>
        ))}

      {s.cancelled && canManage && cancellation && (
        <div className="space-y-2 text-sm">
          {!singleDay && (
            <p className="text-muted-foreground">
              Отменено{" "}
              {cancellation.fromDate === cancellation.untilDate
                ? formatYmd(cancellation.fromDate)
                : `с ${formatYmd(cancellation.fromDate)} по ${formatYmd(cancellation.untilDate)}`}
              {cancellation.slotId === null ? `: все ${session.nomPl} группы` : ""}.
            </p>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void restore()}>
            {singleDay ? `Вернуть ${session.acc}` : "Снять отмену"}
          </Button>
        </div>
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
