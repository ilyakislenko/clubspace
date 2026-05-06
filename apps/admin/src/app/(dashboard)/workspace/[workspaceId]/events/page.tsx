"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

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
  Textarea,
} from "@bjj-academy/ui-kit/ui"

import {
  createEvent,
  deleteEvent,
  listEvents,
  type WorkspaceEvent,
} from "../../../../../shared/api/events"
import { listGyms, type Gym } from "../../../../../shared/api/groups"
import { getWorkspaceSettings } from "../../../../../shared/api/workspaces"

// IANA zones we surface in the picker. The input is free-text via a
// datalist, so anything else can still be typed.
const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Europe/Moscow", label: "Москва (MSK, UTC+3)" },
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск / Томск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Sakhalin", label: "Сахалин (UTC+11)" },
  { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
]

// Build a "DD MMM YYYY, HH:MM – HH:MM (TZ)" string in the event's own
// timezone — using Intl with timeZone lets us render a Tomsk seminar as
// "14:00" to a Moscow-based admin without surprise math.
const formatRangeInTz = (
  startIso: string,
  endIso: string,
  tz: string,
): string => {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const dateFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const timeFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const sameDay = dayKeyFmt.format(start) === dayKeyFmt.format(end)
  if (sameDay) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)}`
  }
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${dateFmt.format(end)}, ${timeFmt.format(end)}`
}

export default function EventsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [gyms, setGyms] = useState<Gym[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Workspace timezone is the default for the new-event form. Loaded
  // alongside events/gyms so the form opens with a sensible value.
  const [workspaceTz, setWorkspaceTz] = useState<string>("Europe/Moscow")

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const [eventsResp, gymsResp, settings] = await Promise.all([
        listEvents({ workspaceId }),
        listGyms({ workspaceId }),
        getWorkspaceSettings({ workspaceId }).catch(() => null),
      ])
      setEvents(eventsResp.data)
      setGyms(gymsResp.data)
      if (settings?.timezone) setWorkspaceTz(settings.timezone)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить события",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const handleDelete = async (event: WorkspaceEvent) => {
    if (!workspaceId) return
    if (!window.confirm(`Удалить событие «${event.title}»?`)) return
    setBusyId(event.id)
    setError(null)
    try {
      await deleteEvent({ workspaceId, eventId: event.id })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Семинары и ивенты</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Семинары, открытые ковры и спец-классы. Видны всем ученикам клуба
            — могут заглянуть в другой зал.
          </p>
        </div>
        {!showForm && (
          <Button type="button" onClick={() => setShowForm(true)}>
            + Новый ивент
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {showForm && workspaceId && (
        <EventForm
          workspaceId={workspaceId}
          gyms={gyms}
          defaultTimezone={workspaceTz}
          onCancel={() => setShowForm(false)}
          onCreated={async () => {
            setShowForm(false)
            await refresh()
          }}
          onError={setError}
        />
      )}

      <section className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg border border-border bg-muted"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Ивентов пока нет.
          </p>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{event.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {formatRangeInTz(
                        event.startAt,
                        event.endAt,
                        event.timezone,
                      )}{" "}
                      <span className="font-mono">({event.timezone})</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {event.gym && (
                        <Link
                          href={`/workspace/${workspaceId}/gyms/${event.gym.id}`}
                          className="hover:underline"
                        >
                          {event.gym.name} · {event.gym.address}
                        </Link>
                      )}
                      {event.coach && (
                        <Link
                          href={`/workspace/${workspaceId}/users/${event.coach.id}`}
                          className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100"
                        >
                          {[event.coach.firstname, event.coach.lastname]
                            .filter(Boolean)
                            .join(" ") || event.coach.email}
                        </Link>
                      )}
                    </div>
                    {event.description && (
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        {event.description}
                      </p>
                    )}
                    {event.link && (
                      <a
                        href={event.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-primary hover:underline"
                      >
                        {event.link}
                      </a>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleDelete(event)}
                    disabled={busyId === event.id}
                  >
                    {busyId === event.id ? "..." : "Удалить"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// Combine a calendar Date with a "HH:MM" string into the wall-clock
// the API expects. We never look at browser-local TZ here — the
// wall-clock is anchored by the explicit timezone field next to it.
const composeWallClock = (date: Date, time: string): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`
}

function EventForm({
  workspaceId,
  gyms,
  defaultTimezone,
  onCancel,
  onCreated,
  onError,
}: {
  workspaceId: string
  gyms: Gym[]
  defaultTimezone: string
  onCancel: () => void
  onCreated: () => void | Promise<void>
  onError: (msg: string) => void
}) {
  // Default: one week ahead, 19:00–20:30. Most coach-published events
  // are evening sessions, so this skips a click for the typical case.
  const oneWeekAhead = new Date(Date.now() + 7 * 86_400_000)
  const defaultDate = new Date(
    oneWeekAhead.getFullYear(),
    oneWeekAhead.getMonth(),
    oneWeekAhead.getDate(),
  )

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [link, setLink] = useState("")
  const [startDate, setStartDate] = useState<Date | null>(defaultDate)
  const [startTime, setStartTime] = useState("19:00")
  const [endDate, setEndDate] = useState<Date | null>(defaultDate)
  const [endTime, setEndTime] = useState("20:30")
  const [timezone, setTimezone] = useState(defaultTimezone)
  const [gymId, setGymId] = useState<string>("none")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startDate || !endDate || !startTime || !endTime) {
      onError("Заполни название, даты и время")
      return
    }
    const startAt = composeWallClock(startDate, startTime)
    const endAt = composeWallClock(endDate, endTime)
    // Fixed-width YYYY-MM-DDTHH:MM means lex order matches chronology.
    if (startAt >= endAt) {
      onError("Начало должно быть раньше конца")
      return
    }
    setSubmitting(true)
    try {
      await createEvent({
        workspaceId,
        data: {
          title: title.trim(),
          description: description.trim() || null,
          link: link.trim() || null,
          // Wall-clock + timezone — server combines them into the
          // absolute UTC instant. No browser-local conversion happens
          // anywhere in the pipeline now, which is the whole point.
          startAt,
          endAt,
          timezone: timezone.trim() || defaultTimezone,
          gymId: gymId === "none" ? null : gymId,
        },
      })
      await onCreated()
    } catch (err) {
      onError(err instanceof Error ? err.message : "Не удалось создать")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-medium">Новый ивент</h3>

      <div>
        <Label htmlFor="event-title">Название</Label>
        <Input
          id="event-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Семинар по ноге"
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <div className="space-y-1">
          <Label>Начало — дата</Label>
          <DatePicker
            value={startDate}
            onChange={(d) => {
              setStartDate(d)
              // Bump end date along with start when they were equal —
              // most events are same-day, this keeps the form sane after
              // changing the start date alone.
              if (d && endDate && endDate.getTime() < d.getTime()) {
                setEndDate(d)
              }
            }}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="event-start-time">Начало — время</Label>
          <Input
            id="event-start-time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Окончание — дата</Label>
          <DatePicker
            value={endDate}
            onChange={setEndDate}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="event-end-time">Окончание — время</Label>
          <Input
            id="event-end-time"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Часовой пояс события</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Время выше — wall-clock в этом поясе. Для томского ивента выбери
          Asia/Krasnoyarsk и пиши «14:00» — клиенты увидят 14:00 на месте,
          даже если воркспейс по умолчанию в Москве.
        </p>
      </div>

      <div>
        <Label>Зал (опционально)</Label>
        <Select value={gymId} onValueChange={setGymId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Без привязки к залу</SelectItem>
            {gyms.map((gym) => (
              <SelectItem key={gym.id} value={gym.id}>
                {gym.name} · {gym.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="event-link">Ссылка (опционально)</Label>
        <Input
          id="event-link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div>
        <Label htmlFor="event-description">Описание</Label>
        <Textarea
          id="event-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Кратко: для кого, что взять, цена."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={submitting || !title.trim()}>
          {submitting ? "Сохраняем…" : "Создать"}
        </Button>
      </div>
    </form>
  )
}
