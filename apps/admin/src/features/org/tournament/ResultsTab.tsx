"use client"

import { Download } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { getTournamentResults, type OrgTournament, type TournamentResults } from "../../../shared/api/tournaments"
import { errorMessage } from "../../../shared/lib/error-message"
import { competitorName, publishedDate, resultsCsv } from "./tournament-view"
import { useVisiblePoll } from "./use-tournament"

const POLL_MS = 10_000

// «Итоги» (design §7): the head coach at the end of the day — per division
// 1 · 2 · 3 · 3, unfinished ones read «идёт»; «Скачать протокол (CSV)».
export function ResultsTab({ tournament }: { tournament: OrgTournament }) {
  const [results, setResults] = useState<TournamentResults | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setResults(await getTournamentResults({ organizationId: tournament.organizationId, tournamentId: tournament.id }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить итоги"))
    }
  }, [tournament.organizationId, tournament.id])

  useEffect(() => {
    void load()
    // The header's status moved (published, unpublished): read again.
  }, [load, tournament.status])

  useVisiblePoll(() => void load(), POLL_MS, tournament.status === "RUNNING")

  const drawn = results?.divisions.filter((d) => d.drawn) ?? []

  const download = () => {
    if (!results) return
    const csv = resultsCsv(
      drawn.map((d) => ({
        name: d.name,
        finished: d.finished,
        podium: d.podium.map((p) => ({ place: p.place, personName: competitorName(p), clubName: p.clubName })),
      })),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${tournament.event.title} — протокол.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {results?.resultsPublishedAt
            ? `Опубликовано ${publishedDate(results.resultsPublishedAt)}`
            : "Итоги видны только команде федерации, пока их не опубликуют."}
        </p>
        {drawn.some((d) => d.finished) && (
          <Button type="button" variant="outline" className="h-11" onClick={download}>
            <Download className="mr-1.5 size-4" />
            Скачать протокол (CSV)
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {results === null ? (
        !error && <div className="h-40 animate-pulse rounded-xl border border-border bg-muted" />
      ) : drawn.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Сеток ещё нет.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {drawn.map((d) => (
            <section key={d.divisionId} className="space-y-2">
              <h3 className="text-sm font-medium">{d.name}</h3>
              {d.finished ? (
                <ol className="divide-y divide-border rounded-lg border border-border">
                  {[...d.podium]
                    .sort((x, y) => x.place - y.place)
                    .map((p) => (
                      <li key={p.entryId} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="w-5 shrink-0 font-semibold tabular-nums">{p.place}</span>
                        <span className="min-w-0 flex-1 truncate">{competitorName(p)}</span>
                        {p.clubName && <span className="shrink-0 text-xs text-muted-foreground">{p.clubName}</span>}
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">идёт</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
