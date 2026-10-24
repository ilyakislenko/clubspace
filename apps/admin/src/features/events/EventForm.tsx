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
  Textarea,
  TimePicker,
} from "@clubspace/ui-kit/ui"

import {
  createEvent,
  updateEvent,
  type WorkspaceEvent,
} from "../../shared/api/events"
import { errorMessage } from "../../shared/lib/error-message"
import { type Gym } from "../../shared/api/groups"
import { type WorkspaceMember } from "../../shared/api/members"

const memberLabel = (m: {
  email: string
  firstname?: string | null
  lastname?: string | null
}): string =>
  [m.firstname, m.lastname].filter(Boolean).join(" ") || m.email

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

// Combine a calendar Date with a "HH:MM" string into the wall-clock the API
// expects. We never look at browser-local TZ here — the wall-clock is
// anchored by the explicit timezone field next to it.
const composeWallClock = (date: Date, time: string): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`
}

// Inverse of composeWallClock for edit prefill: take an absolute UTC instant
// plus the event's timezone and recover the wall-clock the admin originally
// typed — a Date carrying that calendar day (in local components, which is
// how composeWallClock reads it back) and an "HH:MM" string.
const extractWallClock = (
  iso: string,
  tz: string,
): { date: Date; time: string } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  const year = Number(get("year"))
  const month = Number(get("month"))
  const day = Number(get("day"))
  // Intl can emit "24" for midnight with hour12:false; normalize to "00".
  const hour = get("hour") === "24" ? "00" : get("hour")
  return { date: new Date(year, month - 1, day), time: `${hour}:${get("minute")}` }
}

type Props = {
  workspaceId: string
  gyms: Gym[]
  coaches: WorkspaceMember[]
  defaultTimezone: string
  event?: WorkspaceEvent
  onCancel: () => void
  onSaved: () => void | Promise<void>
  onError: (msg: string) => void
}

export function EventForm({
  workspaceId,
  gyms,
  coaches,
  defaultTimezone,
  event,
  onCancel,
  onSaved,
  onError,
}: Props) {
  const isEdit = Boolean(event)
  const eventTz = event?.timezone ?? defaultTimezone
  // Edit: recover the wall-clock the admin typed, in the event's own tz.
  // Create: default to one week ahead, 19:00–20:30 (typical evening session).
  const startWall = event ? extractWallClock(event.startAt, eventTz) : null
  const endWall = event ? extractWallClock(event.endAt, eventTz) : null
  const oneWeekAhead = new Date(Date.now() + 7 * 86_400_000)
  const defaultDate = new Date(
    oneWeekAhead.getFullYear(),
    oneWeekAhead.getMonth(),
    oneWeekAhead.getDate(),
  )

  const [title, setTitle] = useState(event?.title ?? "")
  const [description, setDescription] = useState(event?.description ?? "")
  const [link, setLink] = useState(event?.link ?? "")
  const [startDate, setStartDate] = useState<Date | null>(
    startWall?.date ?? defaultDate,
  )
  const [startTime, setStartTime] = useState(startWall?.time ?? "19:00")
  const [endDate, setEndDate] = useState<Date | null>(
    endWall?.date ?? defaultDate,
  )
  const [endTime, setEndTime] = useState(endWall?.time ?? "20:30")
  const [timezone, setTimezone] = useState(eventTz)
  const [gymId, setGymId] = useState<string>(event?.gym?.id ?? "none")
  const [coachId, setCoachId] = useState<string>(event?.coach?.id ?? "none")
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
      const data = {
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
        coachId: coachId === "none" ? null : coachId,
      }
      if (event) {
        await updateEvent({ workspaceId, eventId: event.id, data })
      } else {
        await createEvent({ workspaceId, data })
      }
      await onSaved()
    } catch (err) {
      onError(
        errorMessage(
          err,
          isEdit ? "Не удалось сохранить" : "Не удалось создать",
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-medium">
        {isEdit ? "Редактировать событие" : "Новое событие"}
      </h3>

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

      <div className="space-y-1">
        <Label>Начало</Label>
        <div className="flex flex-wrap items-center gap-2">
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
            className="flex-1 min-w-[180px]"
          />
          <TimePicker value={startTime} onChange={setStartTime} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Окончание</Label>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            value={endDate}
            onChange={setEndDate}
            className="flex-1 min-w-[180px]"
          />
          <TimePicker value={endTime} onChange={setEndTime} />
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
          Время выше — wall-clock в этом поясе. Для томского события выберите
          Asia/Krasnoyarsk и пиши «14:00» — клиенты увидят 14:00 на месте,
          даже если клуб по умолчанию в Москве.
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
        <Label>Тренер (опционально)</Label>
        <Select value={coachId} onValueChange={setCoachId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Без тренера</SelectItem>
            {coaches.map((coach) => (
              <SelectItem key={coach.userId} value={coach.userId}>
                {memberLabel(coach)}
              </SelectItem>
            ))}
            {event?.coach &&
              !coaches.some((c) => c.userId === event.coach?.id) && (
                <SelectItem value={event.coach.id}>
                  {memberLabel(event.coach)}
                </SelectItem>
              )}
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
          {submitting ? "Сохраняем…" : isEdit ? "Сохранить" : "Создать"}
        </Button>
      </div>
    </form>
  )
}
