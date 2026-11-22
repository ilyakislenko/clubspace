"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { listEvents, type WorkspaceEvent } from "../../../../../shared/api/events"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { listGyms, type Gym } from "../../../../../shared/api/groups"
import {
  listAllStaffMembers,
  type WorkspaceMember,
} from "../../../../../shared/api/members"
import { getWorkspaceSettings } from "../../../../../shared/api/workspaces"
import { safeExternalUrl } from "../../../../../shared/lib/safe-url"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { EventFormSheet } from "../../../../../features/events/EventFormSheet"
import { EventRegistrationsPanel } from "../../../../../features/events/EventRegistrationsPanel"
import { ClassAttendancePanel } from "../../../../../features/schedule/ClassAttendancePanel"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import { isSportLead } from "../../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { timezoneLabel } from "../../../../../shared/lib/timezones"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  matchesDirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { newsTabs } from "../sections"

// Roles that can be credited as the coach leading an event.
const COACH_ROLES = new Set(["admin", "head_coach", "coach"])

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
  // Any coach edits events; a direction manager only their directions' ones.
  const scope = useDirectionScope(workspaceId)
  const isAdmin = isSportLead(useMyMembership(workspaceId))

  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [gyms, setGyms] = useState<Gym[]>([])
  const [coaches, setCoaches] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The event open in the panel; null = a new one.
  const [editingEvent, setEditingEvent] = useState<WorkspaceEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The event whose registrations are unfolded.
  const [openRegistrations, setOpenRegistrations] = useState<string | null>(null)
  // Workspace timezone is the default for the new-event form. Loaded
  // alongside events/gyms so the form opens with a sensible value.
  const [workspaceTz, setWorkspaceTz] = useState<string>("Europe/Moscow")
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const visibleEvents = events.filter((e) =>
    matchesDirectionFilter(directionFilter, e.direction?.id),
  )

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const [eventsResp, gymsResp, membersResp, settings] = await Promise.all([
        listEvents({ workspaceId }),
        listGyms({ workspaceId }),
        listAllStaffMembers({ workspaceId }).catch(
          () => null,
        ),
        getWorkspaceSettings({ workspaceId }).catch(() => null),
      ])
      setEvents(eventsResp.data)
      setGyms(gymsResp.data)
      setCoaches(
        (membersResp ?? []).filter((m) => COACH_ROLES.has(m.roleName)),
      )
      if (settings?.timezone) setWorkspaceTz(settings.timezone)
    } catch (err) {
      setError(
        errorMessage(err, "Не удалось загрузить события"),
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useWorkspaceRealtime(workspaceId, ["events", "gyms"], () => void refresh())

  const openSheet = (event: WorkspaceEvent | null) => {
    setEditingEvent(event)
    setSheetOpen(true)
  }

  return (
    <div className="space-y-6">
      <SectionTabs title="Новости и события" tabs={newsTabs} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Семинары, мастер-классы, турниры и отчётные концерты. Видны всем
          ученикам клуба — могут заглянуть в другой зал.
        </p>
        <Button type="button" className="shrink-0" onClick={() => openSheet(null)}>
          Новое событие
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        {events.length > 0 && directions.length > 0 && (
          <div className="flex justify-end">
            <DirectionFilter
              directions={directions}
              value={directionFilter}
              onChange={setDirectionFilter}
            />
          </div>
        )}
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
            Событий пока нет.
          </p>
        ) : visibleEvents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Нет событий в выбранном направлении.
          </p>
        ) : (
          <ul className="space-y-3">
            {visibleEvents.map((event) => {
              // The row opens the editor for those who may edit the event.
              const canEdit = scope.canEditSharedRow(event.direction?.id)
              const registrationsOpen = openRegistrations === event.id
              const coachName = event.coach
                ? [event.coach.firstname, event.coach.lastname]
                    .filter(Boolean)
                    .join(" ") || event.coach.email
                : null
              const summary = (
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{event.title}</span>
                    <DirectionChip direction={event.direction} />
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                    {formatRangeInTz(event.startAt, event.endAt, event.timezone)}
                    {/* Times are in the event's own zone; name it only when
                        it isn't the club's, as "Томск (UTC+7)". */}
                    {event.timezone !== workspaceTz &&
                      ` · ${timezoneLabel(event.timezone)}`}
                  </span>
                  {(event.gym || coachName || event.hostName) && (
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {event.gym && (
                        <span>
                          {event.gym.name} · {event.gym.address}
                        </span>
                      )}
                      {coachName && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          {coachName}
                        </span>
                      )}
                      {event.hostName && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          Ведёт: {event.hostName}
                        </span>
                      )}
                    </span>
                  )}
                  {event.registration && (
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium">
                        {event.price !== null
                          ? formatAmount(event.price, event.currency)
                          : "Бесплатно"}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {event.capacity !== null
                          ? `Записано ${event.registration.booked} из ${event.capacity}`
                          : `Записано ${event.registration.booked}`}
                        {event.registration.waitlist > 0
                          ? ` · в листе ожидания ${event.registration.waitlist}`
                          : ""}
                      </span>
                    </span>
                  )}
                  {event.description && (
                    <span className="mt-2 block whitespace-pre-wrap text-sm">
                      {event.description}
                    </span>
                  )}
                </>
              )
              return (
                <li
                  key={event.id}
                  className="rounded-lg border border-border bg-card"
                >
                  <div className="flex items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      {canEdit ? (
                        <button
                          type="button"
                          className="block w-full text-left hover:opacity-80"
                          onClick={() => openSheet(event)}
                        >
                          {summary}
                        </button>
                      ) : (
                        <div>{summary}</div>
                      )}
                      {event.link &&
                        (() => {
                          // Defense in depth: server now rejects non-http(s)
                          // URLs at the schema layer, but rows written before
                          // that guard may still hold javascript:/data: URIs.
                          // Render as plain text in that case so the admin
                          // can see what's there without it being clickable.
                          const safe = safeExternalUrl(event.link)
                          return safe ? (
                            <a
                              href={safe}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-xs text-primary hover:underline"
                            >
                              {event.link}
                            </a>
                          ) : (
                            <span className="mt-1 inline-block break-all text-xs text-muted-foreground">
                              {event.link}
                            </span>
                          )
                        })()}
                    </div>
                    {event.registration && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        aria-expanded={registrationsOpen}
                        onClick={() =>
                          setOpenRegistrations(registrationsOpen ? null : event.id)
                        }
                      >
                        {registrationsOpen ? "Скрыть список" : "Записавшиеся"}
                      </Button>
                    )}
                  </div>
                  {event.registration && registrationsOpen && workspaceId && (
                    <div className="space-y-3 border-t border-border p-4">
                      <EventRegistrationsPanel
                        workspaceId={workspaceId}
                        eventId={event.id}
                        canUnmark={isAdmin}
                      />
                      <ClassAttendancePanel
                        workspaceId={workspaceId}
                        session={{ kind: "event", workspaceEventId: event.id }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {workspaceId && (
        <EventFormSheet
          workspaceId={workspaceId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          event={editingEvent}
          gyms={gyms}
          directions={directions}
          coaches={coaches}
          defaultTimezone={workspaceTz}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  )
}
