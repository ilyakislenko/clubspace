"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { listOrganizationClubs, listOrgEvents, type OrgEvent } from "../../../../../shared/api/organizations"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { useOrg } from "../../../../../features/org/org-context"
import { OrgEventSheet, type OrgEventSheetState } from "../../../../../features/org/OrgEventSheet"
import {
  EVENT_KIND_LABEL,
  bookedText,
  eventWhen,
  monthKey,
  monthTitle,
} from "../../../../../features/org/org-view"

// «Календарь»: the federation's tournaments, seminars and grading days by
// month; members of every club sign up in the app.
export default function OrgEventsPage() {
  const { org } = useOrg()
  const [events, setEvents] = useState<OrgEvent[] | null>(null)
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<OrgEventSheetState>(null)

  const load = useCallback(async () => {
    try {
      setEvents((await listOrgEvents({ organizationId: org.id })).data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить календарь"))
    }
  }, [org.id])

  useEffect(() => {
    void load()
    listOrganizationClubs({ organizationId: org.id })
      .then((res) =>
        setClubs(
          res.data
            .filter((c) => c.status === "ACTIVE")
            .map((c) => ({ id: c.club.workspaceId, name: c.club.name })),
        ),
      )
      .catch(() => setClubs([]))
  }, [load, org.id])

  const months = useMemo(() => {
    const byMonth = new Map<string, OrgEvent[]>()
    for (const e of events ?? []) {
      const key = monthKey(e.startAt, e.timezone)
      byMonth.set(key, [...(byMonth.get(key) ?? []), e])
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [events])

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Календарь</h1>
        <Button type="button" onClick={() => setSheet({ mode: "edit", event: null })}>
          Добавить событие
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {events === null ? (
        !error && <div className="h-40 animate-pulse rounded-xl border border-border bg-muted" />
      ) : events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Впереди событий нет.
        </p>
      ) : (
        months.map(([key, list]) => (
          <section key={key} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">{monthTitle(key)}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {list.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="block w-full px-4 py-3 text-left hover:bg-muted/40"
                    onClick={() => setSheet({ mode: "view", event: e })}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.title}</span>
                      {e.publishedAt === null && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Черновик</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[
                        EVENT_KIND_LABEL[e.kind],
                        eventWhen(e.startAt, e.endAt, e.timezone),
                        e.hostClub?.name ?? e.place,
                        bookedText(e.bookedCount, e.capacity),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <OrgEventSheet
        organizationId={org.id}
        state={sheet}
        onStateChange={setSheet}
        clubs={clubs}
        defaultTimezone={org.timezone}
        onSaved={() => void load()}
      />
    </div>
  )
}
