"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import {
  deleteEvent,
  listEvents,
  type WorkspaceEvent,
} from "../../../../../shared/api/events"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { listGyms, type Gym } from "../../../../../shared/api/groups"
import {
  listWorkspaceMembers,
  type WorkspaceMember,
} from "../../../../../shared/api/members"
import { getWorkspaceSettings } from "../../../../../shared/api/workspaces"
import { safeExternalUrl } from "../../../../../shared/lib/safe-url"
import { EventForm } from "../../../../../features/events/EventForm"

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

  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [gyms, setGyms] = useState<Gym[]>([])
  const [coaches, setCoaches] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<WorkspaceEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Workspace timezone is the default for the new-event form. Loaded
  // alongside events/gyms so the form opens with a sensible value.
  const [workspaceTz, setWorkspaceTz] = useState<string>("Europe/Moscow")

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const [eventsResp, gymsResp, membersResp, settings] = await Promise.all([
        listEvents({ workspaceId }),
        listGyms({ workspaceId }),
        listWorkspaceMembers({ workspaceId }).catch(() => null),
        getWorkspaceSettings({ workspaceId }).catch(() => null),
      ])
      setEvents(eventsResp.data)
      setGyms(gymsResp.data)
      setCoaches(
        (membersResp?.data ?? []).filter((m) => COACH_ROLES.has(m.roleName)),
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

  const handleDelete = async (event: WorkspaceEvent) => {
    if (!workspaceId) return
    if (!window.confirm(`Удалить событие «${event.title}»?`)) return
    setBusyId(event.id)
    setError(null)
    try {
      await deleteEvent({ workspaceId, eventId: event.id })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить"))
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
        {!showForm && !editingEvent && (
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

      {(showForm || editingEvent) && workspaceId && (
        <EventForm
          key={editingEvent?.id ?? "new"}
          workspaceId={workspaceId}
          gyms={gyms}
          coaches={coaches}
          defaultTimezone={workspaceTz}
          event={editingEvent ?? undefined}
          onCancel={() => {
            setShowForm(false)
            setEditingEvent(null)
          }}
          onSaved={async () => {
            setShowForm(false)
            setEditingEvent(null)
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
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setShowForm(false)
                        setError(null)
                        setEditingEvent(event)
                      }}
                      disabled={busyId === event.id}
                    >
                      Изменить
                    </Button>
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
