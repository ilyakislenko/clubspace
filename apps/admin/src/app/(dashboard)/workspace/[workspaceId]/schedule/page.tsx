"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getSchedule,
  type ScheduleSession,
} from "../../../../../shared/api/schedule"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  directionFilterParam,
} from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { ClassRosterSheet } from "../../../../../features/schedule/ClassRosterSheet"

// Local calendar day as YYYY-MM-DD (not toISOString — that shifts to UTC).
const toYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const addDays = (d: Date, days: number): Date => {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

const mondayOf = (d: Date): Date => {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return addDays(start, -((start.getDay() + 6) % 7))
}

// The class's club calendar day — the date the booking endpoints key on.
const sessionDateOf = (s: ScheduleSession): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: s.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(s.startAt))

const formatTime = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))

const dayHeading = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
})

const formatDayHeading = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number)
  return dayHeading.format(new Date(Date.UTC(y, m - 1, d)))
}

const coachName = (c: ScheduleSession["group"]["coach"]): string =>
  [c.firstname, c.lastname].filter(Boolean).join(" ") || c.email || "—"

export default function SchedulePage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [sessions, setSessions] = useState<ScheduleSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roster, setRoster] = useState<{
    slotId: string
    sessionDate: string
    booking: boolean
  } | null>(null)
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)

  const from = toYmd(weekStart)
  const to = toYmd(addDays(weekStart, 6))

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const res = await getSchedule({
        workspaceId,
        from,
        to,
        directionId: directionFilterParam(directionFilter),
      })
      setSessions(res.sessions)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить расписание"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, from, to, directionFilter])

  useWorkspaceRealtime(
    workspaceId,
    ["schedule", "classbookings", "groups"],
    () => void refresh(),
  )

  const byDay = new Map<string, ScheduleSession[]>()
  for (const s of [...sessions].sort((a, b) =>
    a.startAt.localeCompare(b.startAt),
  )) {
    const day = sessionDateOf(s)
    byDay.set(day, [...(byDay.get(day) ?? []), s])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Занятия</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Занятия групп по неделям. В группах с записью на занятие видно, сколько
          мест занято; нажмите на занятие, чтобы открыть список записавшихся.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
        >
          ← Неделя
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setWeekStart(mondayOf(new Date()))}
        >
          Эта неделя
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
        >
          Неделя →
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatDayHeading(from)} — {formatDayHeading(to)}
        </span>
        <div className="ml-auto">
          <DirectionFilter
            directions={directions}
            value={directionFilter}
            onChange={setDirectionFilter}
            includeClubOnly={false}
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      ) : byDay.size === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          На этой неделе занятий нет.
        </p>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, daySessions]) => (
            <section key={day} className="space-y-1.5">
              <h2 className="text-sm font-medium first-letter:uppercase">
                {formatDayHeading(day)}
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left font-normal">Время</th>
                      <th className="px-3 py-2 text-left font-normal">Группа</th>
                      <th className="px-3 py-2 text-left font-normal">Зал</th>
                      <th className="px-3 py-2 text-left font-normal">Тренер</th>
                      <th className="px-3 py-2 text-left font-normal">
                        Заполненность
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {daySessions.map((s) => {
                      // Every class opens: attendance and the substitution;
                      // a booking-mode one also its places.
                      const openRoster = () =>
                        setRoster({
                          slotId: s.slotId,
                          sessionDate: sessionDateOf(s),
                          booking: !!s.booking,
                        })
                      return (
                        <tr
                          key={s.occurrenceId}
                          onClick={openRoster}
                          className="cursor-pointer hover:bg-muted/40"
                        >
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                            {formatTime(s.startAt, s.timezone)}–
                            {formatTime(s.endAt, s.timezone)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={
                                  s.cancelled
                                    ? "text-muted-foreground line-through"
                                    : "font-medium"
                                }
                              >
                                {s.group.name}
                              </span>
                              <DirectionChip direction={s.group.direction} />
                              {s.cancelled && (
                                <span
                                  className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20"
                                  title={s.cancellationReason ?? undefined}
                                >
                                  Отменено
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {s.group.gym?.name ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {coachName(s.group.coach)}
                            {s.substitution && (
                              <div
                                className={
                                  s.substitution.status === "APPROVED"
                                    ? "text-xs font-medium text-foreground"
                                    : "text-xs text-amber-700"
                                }
                              >
                                {s.substitution.status === "APPROVED"
                                  ? `Замена: ${coachName(s.substitution.substitute)}`
                                  : `Запрос на замену: ${coachName(s.substitution.substitute)}`}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <Occupancy session={s} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {workspaceId && (
        <ClassRosterSheet
          workspaceId={workspaceId}
          target={roster}
          onClose={() => setRoster(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  )
}

function Occupancy({ session }: { session: ScheduleSession }) {
  const b = session.booking
  if (!b) {
    return (
      <span className="text-muted-foreground">
        {session.bookedGuests > 0
          ? `+${session.bookedGuests} ${pluralRu(session.bookedGuests, "гость", "гостя", "гостей")}`
          : "—"}
      </span>
    )
  }
  const full = b.capacity !== null && b.booked >= b.capacity
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset ${
          full
            ? "bg-amber-50 text-amber-700 ring-amber-600/20"
            : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
        }`}
      >
        {b.capacity === null ? b.booked : `${b.booked}/${b.capacity}`}
      </span>
      {b.waitlist > 0 && (
        <span className="text-xs text-muted-foreground">
          +{b.waitlist} в листе ожидания
        </span>
      )}
    </span>
  )
}
