"use client"

import { useState } from "react"

import { Button, Input, Label, SheetFooter, Textarea } from "@clubspace/ui-kit/ui"

import { createOrgEvent, deleteOrgEvent, updateOrgEvent, type OrgEvent } from "../../shared/api/organizations"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { TimezoneSelect } from "../settings/TimezoneSelect"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { EVENT_KIND_LABEL, EVENT_KINDS, ORG_AUDIENCES, audienceLabel, wallClockInput, type OrgAudience, type OrgEventKind } from "./org-view"

const L = FORM_LIMITS.orgEvent

type Draft = {
  kind: OrgEventKind
  title: string
  description: string
  startAt: string
  endAt: string
  timezone: string
  place: string
  address: string
  hostClubId: string
  audience: OrgAudience
  capacity: string
  registrationOpen: boolean
  registrationClosesAt: string
  feeNote: string
}

const toDraft = (e: OrgEvent | null, defaultTimezone: string): Draft => {
  const tz = e?.timezone ?? defaultTimezone
  return {
    kind: e?.kind ?? "COMPETITION",
    title: e?.title ?? "",
    description: e?.description ?? "",
    startAt: e ? wallClockInput(e.startAt, tz) : "",
    endAt: e?.endAt ? wallClockInput(e.endAt, tz) : "",
    timezone: tz,
    place: e?.place ?? "",
    address: e?.address ?? "",
    hostClubId: e?.hostClub?.id ?? "",
    audience: e?.audience ?? "STAFF_AND_MEMBERS",
    capacity: e?.capacity != null ? String(e.capacity) : "",
    registrationOpen: e?.registrationOpen ?? true,
    registrationClosesAt: e?.registrationClosesAt ? wallClockInput(e.registrationClosesAt, tz) : "",
    feeNote: e?.feeNote ?? "",
  }
}

// The federation event editor (inside the calendar's side panel): kind,
// dates in the event's zone, place, host club, audience, capacity,
// registration and the fee note (text only, paid outside the app).
export function OrgEventForm({
  organizationId,
  event,
  clubs,
  defaultTimezone,
  onCancel,
  onSaved,
}: {
  organizationId: string
  // null = a new event.
  event: OrgEvent | null
  clubs: readonly { id: string; name: string }[]
  defaultTimezone: string
  onCancel: () => void
  onSaved: () => void
}) {
  const vocabulary = useVocabulary()
  const [initial] = useState(() => toDraft(event, defaultTimezone))
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)
  useDirtyGuard(!sameData(d, initial))
  const edit = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))

  const capacity = d.capacity.trim() ? parseIntInput(d.capacity, L.capacity) : null
  const capacityBad = d.capacity.trim() !== "" && capacity === null
  const complete = d.title.trim() !== "" && d.startAt !== "" && !capacityBad

  const fields = () => ({
    kind: d.kind,
    title: d.title.trim(),
    description: d.description.trim() || null,
    startAt: d.startAt,
    endAt: d.endAt || null,
    timezone: d.timezone,
    place: d.place.trim() || null,
    address: d.address.trim() || null,
    hostClubId: d.hostClubId || null,
    audience: d.audience,
    capacity,
    registrationOpen: d.registrationOpen,
    registrationClosesAt: d.registrationClosesAt || null,
    feeNote: d.feeNote.trim() || null,
  })

  const run = async (action: () => Promise<unknown>, failText: string) => {
    setBusy(true)
    setError(null)
    setStale(null)
    try {
      await action()
      onSaved()
    } catch (e) {
      if (isStaleUpdate(e)) setStale(e)
      else setError(errorMessage(e, failText))
    } finally {
      setBusy(false)
    }
  }

  const save = (publish: boolean) =>
    run(
      () =>
        event
          ? updateOrgEvent({
              organizationId,
              eventId: event.id,
              data: { ...fields(), publish, expectedUpdatedAt: event.updatedAt },
            })
          : createOrgEvent({ organizationId, data: { ...fields(), publish } }),
      "Не удалось сохранить событие",
    )

  const remove = async () => {
    if (!event) return
    const ok = await confirmDialog({
      title: `Удалить «${event.title}»?`,
      description:
        event.bookedCount > 0
          ? `Записи (${event.bookedCount}) пропадут; клубы и ученики больше не увидят событие.`
          : "Клубы больше не увидят событие.",
      destructive: true,
    })
    if (ok) await run(() => deleteOrgEvent({ organizationId, eventId: event.id }), "Не удалось удалить событие")
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="org-event-kind">Вид</Label>
            <select
              id="org-event-kind"
              className={inputClsFull}
              value={d.kind}
              onChange={(e) => edit({ kind: e.target.value as OrgEventKind })}
            >
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-event-title">Название</Label>
            <Input
              id="org-event-title"
              value={d.title}
              maxLength={L.title.max}
              onChange={(e) => edit({ title: e.target.value })}
              placeholder="Открытый турнир области"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="org-event-start">Начало</Label>
            <input
              id="org-event-start"
              type="datetime-local"
              className={inputClsFull}
              value={d.startAt}
              onChange={(e) => edit({ startAt: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-event-end">Окончание (необязательно)</Label>
            <input
              id="org-event-end"
              type="datetime-local"
              className={inputClsFull}
              value={d.endAt}
              onChange={(e) => edit({ endAt: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-event-timezone">Часовой пояс события</Label>
          <TimezoneSelect id="org-event-timezone" value={d.timezone} onChange={(timezone) => edit({ timezone })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="org-event-place">Место</Label>
            <Input
              id="org-event-place"
              value={d.place}
              maxLength={L.place.max}
              onChange={(e) => edit({ place: e.target.value })}
              placeholder="Спорткомплекс «Олимп»"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-event-address">Адрес</Label>
            <Input
              id="org-event-address"
              value={d.address}
              maxLength={L.address.max}
              onChange={(e) => edit({ address: e.target.value })}
            />
          </div>
        </div>
        {clubs.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="org-event-host">Принимает клуб</Label>
            <select
              id="org-event-host"
              className={inputClsFull}
              value={d.hostClubId}
              onChange={(e) => edit({ hostClubId: e.target.value })}
            >
              <option value="">Без клуба-хозяина</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="org-event-audience">Для кого</Label>
            <select
              id="org-event-audience"
              className={inputClsFull}
              value={d.audience}
              onChange={(e) => edit({ audience: e.target.value as OrgAudience })}
            >
              {ORG_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {audienceLabel(a, vocabulary)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-event-capacity">Мест (необязательно)</Label>
            <Input
              id="org-event-capacity"
              inputMode="numeric"
              value={d.capacity}
              onChange={(e) => edit({ capacity: e.target.value })}
              aria-invalid={capacityBad}
            />
            {capacityBad && (
              <p className="text-xs text-destructive">
                Целое число от {L.capacity.min} до {L.capacity.max}
              </p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={d.registrationOpen}
            onChange={(e) => edit({ registrationOpen: e.target.checked })}
          />
          Запись открыта
        </label>
        {d.registrationOpen && (
          <div className="space-y-2">
            <Label htmlFor="org-event-closes">Запись до (необязательно)</Label>
            <input
              id="org-event-closes"
              type="datetime-local"
              className={inputClsFull}
              value={d.registrationClosesAt}
              onChange={(e) => edit({ registrationClosesAt: e.target.value })}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="org-event-fee">Взнос (текстом)</Label>
          <Input
            id="org-event-fee"
            value={d.feeNote}
            maxLength={L.feeNote.max}
            onChange={(e) => edit({ feeNote: e.target.value })}
            placeholder="Взнос 1 500 ₽ на месте"
          />
          <p className="text-xs text-muted-foreground">Оплата — вне приложения; запись бесплатная.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-event-description">Описание</Label>
          <Textarea
            id="org-event-description"
            rows={4}
            value={d.description}
            maxLength={L.description.max}
            onChange={(e) => edit({ description: e.target.value })}
          />
        </div>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {stale !== null && <StaleUpdateNotice error={stale} onReload={onSaved} />}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center gap-2">
          {event && (
            <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}>
              Удалить
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Отмена
            </Button>
            {event && event.publishedAt !== null ? (
              <Button type="button" disabled={busy || !complete} onClick={() => void save(true)}>
                {busy ? "Сохраняем…" : "Сохранить"}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy || !complete} onClick={() => void save(false)}>
                  В черновик
                </Button>
                <Button type="button" disabled={busy || !complete} onClick={() => void save(true)}>
                  Опубликовать
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetFooter>
    </>
  )
}
