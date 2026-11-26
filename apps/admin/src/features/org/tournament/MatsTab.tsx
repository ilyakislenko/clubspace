"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import {
  getTournamentMatQueue,
  getTournamentBracket,
  type OrgTournament,
  type TournamentMatQueue,
  type TournamentQueueMatch,
} from "../../../shared/api/tournaments"
import { errorMessage } from "../../../shared/lib/error-message"
import { MatchResultSheet } from "./MatchResultSheet"
import { competitorName } from "./tournament-view"
import { readQueryParam, setQueryParam, useVisiblePoll } from "./use-tournament"
import { useResultToast } from "./use-result-toast"

const POLL_MS = 10_000

// «Ковры» (design §7): the table secretary's screen — one mat at a time
// (`?mat=`), the match on it now with «Записать результат», then the next 5
// (row tap records that one out of order). Polls every 10 s while visible.
export function MatsTab({
  tournament,
  orgType,
  onChanged,
}: {
  tournament: OrgTournament
  orgType: string
  // A result moved the header's counts (a division finished → «Опубликовать итоги»).
  onChanged: () => void
}) {
  const ids = { organizationId: tournament.organizationId, tournamentId: tournament.id }
  const [mat, setMat] = useState(() => {
    const n = Number(typeof window === "undefined" ? null : readQueryParam("mat"))
    return Number.isInteger(n) && n >= 1 && n <= tournament.matCount ? n : 1
  })
  const [queue, setQueue] = useState<TournamentMatQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ match: TournamentQueueMatch; rounds: number } | null>(null)

  const load = useCallback(async () => {
    try {
      setQueue(await getTournamentMatQueue({ ...ids, mat }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить очередь ковра"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.organizationId, tournament.id, mat])

  useEffect(() => {
    setQueue(null)
    void load()
  }, [load])

  const running = tournament.status === "RUNNING"
  useVisiblePoll(() => void load(), POLL_MS, running && open === null)
  const { recorded, toast } = useResultToast(tournament.organizationId, tournament.id, () => {
    void load()
    onChanged()
  })

  // The undo confirm and the title name the round: the division's rounds come
  // with its bracket.
  const openMatch = async (match: TournamentQueueMatch) => {
    try {
      const bracket = await getTournamentBracket({ ...ids, divisionId: match.divisionId })
      setOpen({ match, rounds: bracket.rounds })
    } catch (e) {
      setError(errorMessage(e, "Не удалось открыть схватку"))
    }
  }

  const switchMat = (next: number) => {
    setMat(next)
    setQueryParam("mat", String(next))
  }

  return (
    <div className="space-y-6">
      {tournament.matCount > 1 && (
        <div role="tablist" aria-label="Ковёр" className="inline-flex flex-wrap gap-1 rounded-lg border border-border p-1">
          {Array.from({ length: tournament.matCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={mat === n}
              onClick={() => switchMat(n)}
              className={cn(
                "min-h-12 min-w-24 rounded-md px-4 text-sm font-medium transition-colors",
                mat === n ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              Ковёр {n}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {queue === null ? (
        !error && <div className="h-48 animate-pulse rounded-xl border border-border bg-muted" />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Сейчас</h2>
            {queue.current ? (
              <CurrentMatch match={queue.current} onRecord={() => void openMatch(queue.current as TournamentQueueMatch)} />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                На этом ковре схваток не осталось.
              </p>
            )}
          </section>

          {queue.next.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">Далее</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {queue.next.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
                      onClick={() => void openMatch(m)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {competitorName(m.entryA)} — {competitorName(m.entryB)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{m.divisionName}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {queue.unassignedDivisions > 0 && (
            <p className="text-sm text-muted-foreground">
              Ковёр не назначен: {queue.unassignedDivisions} — распределите категории на вкладке «Категории».
            </p>
          )}
        </>
      )}

      <MatchResultSheet
        {...ids}
        orgType={orgType}
        match={open?.match ?? null}
        divisionName={open?.match.divisionName ?? ""}
        rounds={open?.rounds ?? 1}
        canEdit={running}
        onClose={() => setOpen(null)}
        onRecorded={(r) => {
          setOpen(null)
          recorded(r)
        }}
        onUndone={() => {
          setOpen(null)
          void load()
          onChanged()
        }}
      />
      {toast}
    </div>
  )
}

function CurrentMatch({ match, onRecord }: { match: TournamentQueueMatch; onRecord: () => void }) {
  return (
    <div className="space-y-4 rounded-xl border border-border p-5">
      <div className="text-sm text-muted-foreground">{match.divisionName}</div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        {[match.entryA, match.entryB].map((side, i) => (
          <div key={side?.entryId ?? i} className={cn("min-w-0", i === 1 && "sm:order-3 sm:text-right")}>
            <div className="truncate text-xl font-semibold">{competitorName(side)}</div>
            {side?.clubName && <div className="truncate text-sm text-muted-foreground">{side.clubName}</div>}
          </div>
        ))}
        <span className="hidden text-muted-foreground sm:order-2 sm:block">—</span>
      </div>
      <Button type="button" className="h-14 w-full text-base" onClick={onRecord}>
        Записать результат
      </Button>
    </div>
  )
}
