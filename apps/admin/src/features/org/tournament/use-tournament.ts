"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getOrgEvent } from "../../../shared/api/organizations"
import { getOrgTournament, type OrgTournament } from "../../../shared/api/tournaments"
import { errorMessage } from "../../../shared/lib/error-message"

export type TournamentState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; tournament: OrgTournament }

// The tournament of a calendar event (the console's URLs carry the event id,
// the API the tournament id). `reload` re-reads the tournament only.
export function useEventTournament(organizationId: string, eventId: string) {
  const [state, setState] = useState<TournamentState>({ kind: "loading" })
  const tournamentId = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      if (!tournamentId.current) {
        const event = await getOrgEvent({ organizationId, eventId })
        if (!event.tournament) {
          setState({ kind: "missing" })
          return
        }
        tournamentId.current = event.tournament.id
      }
      const tournament = await getOrgTournament({ organizationId, tournamentId: tournamentId.current })
      setState({ kind: "ready", tournament })
    } catch (e) {
      setState({ kind: "failed", message: errorMessage(e, "Не удалось загрузить турнир") })
    }
  }, [organizationId, eventId])

  useEffect(() => {
    void load()
  }, [load])

  return { state, reload: load, replace: (tournament: OrgTournament) => setState({ kind: "ready", tournament }) }
}

// Calls `tick` every `ms` while `enabled` and the tab is visible, and once
// when the tab comes back (design §13.14: polling, not sockets).
export function useVisiblePoll(tick: () => void, ms: number, enabled: boolean): void {
  const latest = useRef(tick)
  latest.current = tick
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") latest.current()
    }, ms)
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [ms, enabled])
}

// `?tab=` / `?mat=` without a navigation (the URL is the state, design §7).
export const setQueryParam = (key: string, value: string | null): void => {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  window.history.replaceState(null, "", url)
}

export const readQueryParam = (key: string): string | null =>
  new URLSearchParams(window.location.search).get(key)
