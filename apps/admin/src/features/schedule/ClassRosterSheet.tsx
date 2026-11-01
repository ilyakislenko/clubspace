"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  addClassBooking,
  getClassOccurrence,
  removeClassBooking,
  setClassCapacity,
  type ClassOccurrence,
  type ClassOccurrenceBooking,
} from "../../shared/api/class-bookings"
import { createGroupException } from "../../shared/api/groups"
import {
  listWorkspaceMembers,
  type WorkspaceMember,
} from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { formatMemberLabel, matchesMemberQuery } from "../groups/helpers"
import {
  CLASS_BOOKING_STATUS_LABEL,
  CLASS_BOOKING_STATUS_TONE,
} from "./class-booking-labels"
import { ClassAttendancePanel } from "./ClassAttendancePanel"
import { ClassSubstitutionPanel } from "./ClassSubstitutionPanel"

type Props = {
  workspaceId: string
  // The class to show; null keeps the sheet closed. `booking` = a class of a
  // «Запись на занятие» group (places, waitlist); every class gets the
  // attendance marking and the substitution.
  target: { slotId: string; sessionDate: string; booking: boolean } | null
  onClose: () => void
  // Bookings / capacity / cancellation changed — the caller refreshes its list.
  onChanged: () => void
}

const formatClassTime = (o: ClassOccurrence): string => {
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: o.timezone,
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(new Date(o.startAt))
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: o.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${date}, ${time.format(new Date(o.startAt))} – ${time.format(new Date(o.endAt))}`
}

// Bookings that still hold (or held and used) a place in the class.
const LIVE_STATUS: Record<ClassOccurrenceBooking["status"], boolean> = {
  BOOKED: true,
  WAITLISTED: true,
  ATTENDED: true,
  CANCELLED: false,
  LATE_CANCELLED: false,
  NO_SHOW: false,
  CANCELLED_BY_CLUB: false,
  EXPIRED: false,
}

export function ClassRosterSheet({
  workspaceId,
  target,
  onClose,
  onChanged,
}: Props) {
  const [occurrence, setOccurrence] = useState<ClassOccurrence | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capacityDraft, setCapacityDraft] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")

  const slotId = target?.slotId
  const sessionDate = target?.sessionDate

  const load = async () => {
    if (!slotId || !sessionDate) return
    try {
      const data = await getClassOccurrence({ workspaceId, slotId, sessionDate })
      setOccurrence(data)
      setCapacityDraft(data.capacity === null ? "" : String(data.capacity))
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить запись на занятие"))
    }
  }

  useEffect(() => {
    if (!slotId || !sessionDate) return
    setOccurrence(null)
    setError(null)
    setPickerOpen(false)
    setCancelOpen(false)
    setCancelReason("")
    setLoading(true)
    void load().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, slotId, sessionDate])

  // Members for the «Записать ученика» picker, loaded once per club.
  useEffect(() => {
    let alive = true
    listWorkspaceMembers({ workspaceId })
      .then((r) => alive && setMembers(r.data))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [workspaceId])

  useWorkspaceRealtime(
    target ? workspaceId : undefined,
    ["classbookings", "attendance", "schedule"],
    () => void load(),
  )

  // Applies a staff action that returns the fresh roster.
  const run = async (
    action: () => Promise<ClassOccurrence>,
    failure: string,
  ) => {
    setBusy(true)
    setError(null)
    try {
      const data = await action()
      setOccurrence(data)
      setCapacityDraft(data.capacity === null ? "" : String(data.capacity))
      onChanged()
    } catch (err) {
      setError(errorMessage(err, failure))
    } finally {
      setBusy(false)
    }
  }

  const handleAdd = (userId: string) => {
    if (!slotId || !sessionDate) return
    setPickerOpen(false)
    setQuery("")
    void run(
      () => addClassBooking({ workspaceId, slotId, sessionDate, userId }),
      "Не удалось записать ученика",
    )
  }

  const handleRemove = (b: ClassOccurrenceBooking) => {
    if (!slotId || !sessionDate) return
    if (!window.confirm(`Снять «${b.displayName}» с занятия?`)) return
    void run(
      () =>
        removeClassBooking({
          workspaceId,
          slotId,
          sessionDate,
          bookingId: b.bookingId,
        }),
      "Не удалось снять с занятия",
    )
  }

  const parsedCapacity = capacityDraft.trim()
    ? parseIntInput(capacityDraft, { min: 1, max: 1000 })
    : null
  const capacityInvalid = capacityDraft.trim() !== "" && parsedCapacity === null

  const handleSetCapacity = (capacity: number | null) => {
    if (!slotId || !sessionDate) return
    void run(
      () => setClassCapacity({ workspaceId, slotId, sessionDate, capacity }),
      "Не удалось изменить число мест",
    )
  }

  const handleCancelClass = async () => {
    if (!occurrence || !sessionDate) return
    setBusy(true)
    setError(null)
    try {
      await createGroupException({
        workspaceId,
        groupId: occurrence.groupId,
        data: {
          slotId: occurrence.slotId,
          fromDate: sessionDate,
          untilDate: sessionDate,
          reason: cancelReason.trim() || null,
        },
      })
      setCancelOpen(false)
      setCancelReason("")
      await load()
      onChanged()
    } catch (err) {
      setError(errorMessage(err, "Не удалось отменить занятие"))
    } finally {
      setBusy(false)
    }
  }

  const bookings = occurrence?.bookings ?? []
  const booked = bookings.filter((b) => b.status === "BOOKED")
  const waitlist = bookings
    .filter((b) => b.status === "WAITLISTED")
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))
  const attended = bookings.filter((b) => b.status === "ATTENDED")
  const history = bookings.filter((b) => !LIVE_STATUS[b.status])
  const liveUserIds = new Set(
    bookings.filter((b) => LIVE_STATUS[b.status]).map((b) => b.userId),
  )
  const candidates = members.filter(
    (m) => m.status === "ACTIVE" && !liveUserIds.has(m.userId),
  )
  const filtered = candidates.filter((m) => matchesMemberQuery(m, query))
  const editable =
    !!occurrence && !occurrence.settled && !occurrence.classCancelled

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{occurrence?.groupName ?? "Запись на занятие"}</SheetTitle>
          <SheetDescription>
            {occurrence
              ? [
                  formatClassTime(occurrence),
                  occurrence.gym?.name,
                  occurrence.coachName,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Загружаем…"}
          </SheetDescription>
        </SheetHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {slotId && sessionDate && (
          <>
            <ClassSubstitutionPanel
              workspaceId={workspaceId}
              slotId={slotId}
              sessionDate={sessionDate}
              onChanged={onChanged}
            />
            <ClassAttendancePanel
              key={`${slotId}:${sessionDate}`}
              workspaceId={workspaceId}
              slotId={slotId}
              sessionDate={sessionDate}
            />
          </>
        )}

        {loading && !occurrence ? (
          <div className="h-32 animate-pulse rounded-lg border border-border bg-muted" />
        ) : occurrence && target?.booking ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Stat
                label="Записано"
                value={
                  occurrence.capacity === null
                    ? String(occurrence.booked)
                    : `${occurrence.booked}/${occurrence.capacity}`
                }
              />
              <Stat label="В листе ожидания" value={String(occurrence.waitlist)} />
              <Stat label="Пришли" value={String(occurrence.attended)} />
              {occurrence.classCancelled && (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                  Занятие отменено
                </span>
              )}
              {occurrence.settled && (
                <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
                  Итоги подведены
                </span>
              )}
            </div>

            {editable && (
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <Label htmlFor="class-capacity" className="text-xs">
                  Мест на это занятие
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="class-capacity"
                    inputMode="numeric"
                    value={capacityDraft}
                    onChange={(e) => setCapacityDraft(e.target.value)}
                    placeholder="без ограничений"
                    aria-invalid={capacityInvalid}
                    className="h-9 w-[140px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      busy ||
                      capacityInvalid ||
                      parsedCapacity === occurrence.capacity
                    }
                    onClick={() => handleSetCapacity(parsedCapacity)}
                  >
                    Сохранить
                  </Button>
                  {occurrence.capacityOverride !== null && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => handleSetCapacity(null)}
                    >
                      Как в расписании
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {occurrence.capacityOverride !== null
                    ? "Число мест изменено только для этой даты."
                    : "Сейчас — как в расписании группы. Изменение действует только на эту дату."}
                </p>
              </div>
            )}

            <RosterSection
              title={`Записаны (${booked.length})`}
              empty="Пока никто не записался"
              rows={booked}
              onRemove={editable ? handleRemove : undefined}
              busy={busy}
            />

            {editable && (
              <div>
                {pickerOpen ? (
                  <div className="space-y-1 rounded-md border border-border bg-card p-1">
                    <Input
                      autoFocus
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setPickerOpen(false)
                          setQuery("")
                        }
                      }}
                      placeholder="Имя или email"
                      className="h-8 text-xs"
                    />
                    <ul className="max-h-48 overflow-y-auto">
                      {filtered.length === 0 && (
                        <li className="px-2 py-1 text-xs text-muted-foreground">
                          {candidates.length === 0
                            ? "Некого записать"
                            : "Никого не найдено"}
                        </li>
                      )}
                      {filtered.map((m) => (
                        <li key={m.userId}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAdd(m.userId)}
                            className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
                          >
                            {formatMemberLabel(m)}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => {
                        setPickerOpen(false)
                        setQuery("")
                      }}
                      className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60"
                    >
                      Закрыть
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setPickerOpen(true)}
                  >
                    + Записать ученика
                  </Button>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Ученик записывается, даже если мест нет — сверх лимита.
                </p>
              </div>
            )}

            <RosterSection
              title={`Лист ожидания (${waitlist.length})`}
              empty="Лист ожидания пуст"
              rows={waitlist}
              onRemove={editable ? handleRemove : undefined}
              busy={busy}
            />

            {attended.length > 0 && (
              <RosterSection
                title={`Пришли (${attended.length})`}
                empty=""
                rows={attended}
                busy={busy}
              />
            )}

            {history.length > 0 && (
              <RosterSection
                title={`История (${history.length})`}
                empty=""
                rows={history}
                busy={busy}
              />
            )}

            {editable && (
              <div className="border-t border-border pt-3">
                {cancelOpen ? (
                  <div className="space-y-2">
                    <Label htmlFor="class-cancel-reason" className="text-xs">
                      Причина (увидят записавшиеся)
                    </Label>
                    <Input
                      id="class-cancel-reason"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Например: тренер заболел"
                    />
                    <p className="text-xs text-muted-foreground">
                      Все записи будут отменены без списания занятий, ученики
                      получат уведомление.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void handleCancelClass()}
                      >
                        {busy ? "..." : "Отменить занятие"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setCancelOpen(false)}
                      >
                        Не отменять
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setCancelOpen(true)}
                  >
                    Отменить занятие
                  </Button>
                )}
              </div>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  )
}

function RosterSection({
  title,
  empty,
  rows,
  onRemove,
  busy,
}: {
  title: string
  empty: string
  rows: ClassOccurrenceBooking[]
  onRemove?: (b: ClassOccurrenceBooking) => void
  busy: boolean
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase text-muted-foreground">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((b) => (
            <li
              key={b.bookingId}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              {b.waitlistPosition !== null && b.status === "WAITLISTED" && (
                <span className="w-6 text-xs tabular-nums text-muted-foreground">
                  #{b.waitlistPosition}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{b.displayName}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CLASS_BOOKING_STATUS_TONE[b.status]}`}
              >
                {CLASS_BOOKING_STATUS_LABEL[b.status]}
              </span>
              {b.overCapacity && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                  сверх лимита
                </span>
              )}
              {b.promotedAt && (
                <span className="text-xs text-muted-foreground">
                  из листа ожидания
                </span>
              )}
              {b.bookedByOther && (
                <span className="text-xs text-muted-foreground">
                  записал другой
                </span>
              )}
              {b.classBurned && (
                <span className="w-full text-xs text-amber-700">
                  списано занятие
                  {b.burnedPlanName ? `: ${b.burnedPlanName}` : ""}
                </span>
              )}
              {onRemove && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => onRemove(b)}
                >
                  Снять
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
