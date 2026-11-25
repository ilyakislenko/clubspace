"use client"

import { Download, Pencil } from "lucide-react"
import { useEffect, useState } from "react"

import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"

import {
  listOrgEventRegistrations,
  type OrgEvent,
  type OrgEventRegistrations,
} from "../../shared/api/organizations"
import { errorMessage } from "../../shared/lib/error-message"
import { pluralRu } from "../../shared/lib/plural-ru"
import { confirmLeave } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { BeltDot } from "./BeltDot"
import { OrgEventForm } from "./OrgEventForm"
import {
  audienceLabel,
  EVENT_KIND_LABEL,
  beltText,
  bookedByLabel,
  bookedText,
  eventWhen,
  groupByClub,
  toCsv,
} from "./org-view"

export type OrgEventSheetState = { mode: "view"; event: OrgEvent } | { mode: "edit"; event: OrgEvent | null } | null

// The calendar's one side panel: an event with its registrations by club and
// «Скачать список», or the editor (a new event, «Изменить»). One panel, two
// faces — a panel never opens a second one.
export function OrgEventSheet({
  organizationId,
  state,
  onStateChange,
  clubs,
  defaultTimezone,
  onSaved,
}: {
  organizationId: string
  state: OrgEventSheetState
  onStateChange: (next: OrgEventSheetState) => void
  clubs: readonly { id: string; name: string }[]
  defaultTimezone: string
  onSaved: () => void
}) {
  const close = async () => {
    if (state?.mode === "edit" && !(await confirmLeave())) return
    onStateChange(null)
  }
  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && void close()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        {state?.mode === "edit" && (
          <>
            <SheetHeader>
              <SheetTitle>{state.event ? "Редактировать событие" : "Новое событие"}</SheetTitle>
              <SheetDescription>Время — в часовом поясе события.</SheetDescription>
            </SheetHeader>
            <OrgEventForm
              key={state.event?.id ?? "new"}
              organizationId={organizationId}
              event={state.event}
              clubs={clubs}
              defaultTimezone={defaultTimezone}
              onCancel={() => void close()}
              onSaved={() => {
                onSaved()
                onStateChange(null)
              }}
            />
          </>
        )}
        {state?.mode === "view" && (
          <EventDetails
            organizationId={organizationId}
            event={state.event}
            onEdit={() => onStateChange({ mode: "edit", event: state.event })}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function EventDetails({
  organizationId,
  event,
  onEdit,
}: {
  organizationId: string
  event: OrgEvent
  onEdit: () => void
}) {
  const vocabulary = useVocabulary()
  const [regs, setRegs] = useState<OrgEventRegistrations | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listOrgEventRegistrations({ organizationId, eventId: event.id })
      .then((r) => !cancelled && setRegs(r))
      .catch((e) => !cancelled && setError(errorMessage(e, "Не удалось загрузить записи")))
    return () => {
      cancelled = true
    }
  }, [organizationId, event.id])

  const booked = (regs?.data ?? []).filter((r) => r.status === "BOOKED")
  const groups = groupByClub(booked)

  const download = () => {
    const csv = toCsv(
      ["Клуб", "Имя", "Пояс", "Кто записал"],
      groups.flatMap((g) =>
        g.rows.map((r) => [
          g.clubName,
          r.personName,
          r.belt ? beltText(r.belt) : "",
          bookedByLabel(r.bookedBy, vocabulary),
        ]),
      ),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${event.title}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const facts = [
    event.place && event.address ? `${event.place}, ${event.address}` : (event.place ?? event.address),
    event.hostClub ? `Принимает клуб ${event.hostClub.name}` : null,
    audienceLabel(event.audience, vocabulary),
    event.feeNote,
    !event.registrationOpen ? "Запись закрыта" : null,
  ].filter(Boolean)

  return (
    <>
      <SheetHeader>
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <SheetTitle>{event.title}</SheetTitle>
            <SheetDescription>
              {EVENT_KIND_LABEL[event.kind]} · {eventWhen(event.startAt, event.endAt, event.timezone)}
            </SheetDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="mr-1 size-4" />
            Изменить
          </Button>
        </div>
      </SheetHeader>
      <div className="flex-1 space-y-5 overflow-y-auto text-sm">
        {facts.length > 0 && (
          <ul className="space-y-1 text-muted-foreground">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {event.description && <p className="whitespace-pre-wrap">{event.description}</p>}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">{bookedText(event.bookedCount, event.capacity)}</h3>
            {booked.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={download}>
                <Download className="mr-1 size-4" />
                Скачать список
              </Button>
            )}
          </div>
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>
          )}
          {regs === null ? (
            !error && <div className="h-20 animate-pulse rounded-lg border border-border bg-muted" />
          ) : booked.length === 0 ? (
            // Bookings without a name (withdrawn consent, club left) are counted below.
            regs.hiddenCount === 0 && <p className="text-muted-foreground">Пока никто не записался.</p>
          ) : (
            groups.map((g) => (
              <div key={g.clubName} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {g.clubName} · {g.rows.length}
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{r.personName}</span>
                      {r.belt && (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <BeltDot color={r.belt.levelColor} />
                          {beltText(r.belt)}
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {bookedByLabel(r.bookedBy, vocabulary)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {regs && regs.hiddenCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Ещё {regs.hiddenCount} {pluralRu(regs.hiddenCount, "запись", "записи", "записей")} без имени: человек
              отозвал согласие или его клуб вышел из федерации.
            </p>
          )}
        </section>
      </div>
    </>
  )
}
