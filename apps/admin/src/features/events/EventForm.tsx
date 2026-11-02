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

import { type Direction } from "../../shared/api/directions"
import {
  createEvent,
  updateEvent,
  type WorkspaceEvent,
} from "../../shared/api/events"
import { errorMessage } from "../../shared/lib/error-message"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { type Gym } from "../../shared/api/groups"
import { type WorkspaceMember } from "../../shared/api/members"
import { useDirectionScope } from "../../shared/workspace/use-direction-scope"
import { DirectionSelect } from "../directions/DirectionSelect"
import { TimezoneSelect } from "../settings/TimezoneSelect"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { cap } from "@clubspace/ui-kit/brand"

const memberLabel = (m: {
  email: string | null
  firstname?: string | null
  lastname?: string | null
}): string =>
  [m.firstname, m.lastname].filter(Boolean).join(" ") || m.email || "—"

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
  // Club directions; the selector hides itself when empty.
  directions: Direction[]
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
  directions,
  coaches,
  defaultTimezone,
  event,
  onCancel,
  onSaved,
  onError,
}: Props) {
  const vocabulary = useVocabulary()
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
  // A master class: a guest host, a ticket price, a limit of places. Blank =
  // none (a free open event, as before).
  const [hostName, setHostName] = useState(event?.hostName ?? "")
  const [price, setPrice] = useState(event?.price != null ? String(event.price) : "")
  const [currency, setCurrency] = useState(event?.currency ?? "RUB")
  const [capacity, setCapacity] = useState(
    event?.capacity != null ? String(event.capacity) : "",
  )
  // A direction manager posts only to their directions (never club-wide).
  const scope = useDirectionScope(workspaceId)
  const [directionId, setDirectionId] = useState<string | null>(
    event ? (event.direction?.id ?? null) : scope.defaultDirectionId,
  )
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
    const priceValue = price.trim()
      ? parseIntInput(price, { min: 1, max: 10_000_000 })
      : null
    if (price.trim() && priceValue === null) {
      onError("Цена — целое число больше нуля (или оставьте пустой — бесплатно)")
      return
    }
    const capacityValue = capacity.trim()
      ? parseIntInput(capacity, { min: 1, max: 10_000 })
      : null
    if (capacity.trim() && capacityValue === null) {
      onError("Мест — целое число больше нуля (или оставьте пустым — без лимита)")
      return
    }
    const currencyCode = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      onError("Валюта — код из 3 букв, например RUB")
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
        directionId,
        hostName: hostName.trim() || null,
        price: priceValue,
        currency: currencyCode,
        capacity: capacityValue,
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
          placeholder={`Мастер-класс приглашённого ${vocabulary.coach.gen}`}
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
        <Label htmlFor="event-timezone">Часовой пояс события</Label>
        <TimezoneSelect
          id="event-timezone"
          value={timezone}
          onChange={setTimezone}
        />
        <p className="text-xs text-muted-foreground">
          Время события указано по выбранному часовому поясу — участники
          увидят его по местному времени площадки.
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
        <Label>{cap(vocabulary.coach.nom)} (опционально)</Label>
        <Select value={coachId} onValueChange={setCoachId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Без {vocabulary.coach.gen}</SelectItem>
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
        <Label htmlFor="event-host">Приглашённый ведущий (опционально)</Label>
        <Input
          id="event-host"
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
          placeholder="Имя и город, например: Анна Петрова, Москва"
          maxLength={255}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Если ведёт не участник клуба — участники увидят это имя вместо{" "}
          {vocabulary.coach.gen}.
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="text-sm font-medium">Запись и оплата</div>
        <p className="text-xs text-muted-foreground">
          Для мастер-класса: укажите цену и/или число мест — участники
          запишутся в приложении, а когда места кончатся, встанут в лист
          ожидания. Оплату на месте отмечаете в списке записавшихся, абонемент
          за платное событие не списывается. Без цены и мест событие открытое:
          приходят все желающие, записываться не нужно.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="event-price">Цена</Label>
            <Input
              id="event-price"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Бесплатно"
            />
          </div>
          <div>
            <Label htmlFor="event-currency">Валюта</Label>
            <Input
              id="event-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={3}
            />
          </div>
          <div>
            <Label htmlFor="event-capacity">Мест</Label>
            <Input
              id="event-capacity"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Без лимита"
            />
          </div>
        </div>
      </div>

      <DirectionSelect
        id="event-direction"
        directions={directions}
        value={directionId}
        onChange={setDirectionId}
        allowedIds={scope.allowedDirectionIds}
        hint="Событие видно всему клубу; направление — метка для фильтра расписания."
      />

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
          placeholder="Кратко: для кого, что взять с собой."
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
