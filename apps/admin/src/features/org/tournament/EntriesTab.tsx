"use client"

import { AlertTriangle, CheckCircle2, Circle, Clock, Search, UserX } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  listTournamentDivisions,
  listTournamentEntries,
  type OrgTournament,
  type TournamentDivision,
  type TournamentEntry,
} from "../../../shared/api/tournaments"
import { errorMessage } from "../../../shared/lib/error-message"
import { readQueryParam, setQueryParam } from "./use-tournament"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { ENTRY_FILTER_IDS, competitorName, entryFilters, weightLine, type EntryFilter } from "./tournament-view"
import { WeighInSheet } from "./WeighInSheet"

const PER_PAGE = 50

// «Участники» (design §7): the weigh-in volunteer's list — search by surname
// first, one Select filter, row tap opens the sheet. No per-row buttons.
export function EntriesTab({
  tournament,
  onChanged,
}: {
  tournament: OrgTournament
  // Counts in the header moved (weighed, moved, withdrawn).
  onChanged: () => void
}) {
  const vocabulary = useVocabulary()
  const ids = { organizationId: tournament.organizationId, tournamentId: tournament.id }
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<EntryFilter>(() => {
    const raw = typeof window === "undefined" ? null : readQueryParam("filter")
    return ENTRY_FILTER_IDS.find((id) => id === raw) ?? "all"
  })
  const [rows, setRows] = useState<TournamentEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [divisions, setDivisions] = useState<TournamentDivision[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<TournamentEntry | null>(null)

  // The search fires after a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(
    async (curPage: number) => {
      try {
        const res = await listTournamentEntries({ ...ids, q: query, filter, curPage, perPage: PER_PAGE })
        setRows((prev) => (curPage === 1 ? res.data : [...(prev ?? []), ...res.data]))
        setTotal(res.total)
        setPage(curPage)
        setError(null)
      } catch (e) {
        setError(errorMessage(e, "Не удалось загрузить участников"))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tournament.organizationId, tournament.id, query, filter],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  useEffect(() => {
    listTournamentDivisions(ids)
      .then((res) => setDivisions(res.data))
      .catch(() => setDivisions([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.organizationId, tournament.id])

  const changed = (entry: TournamentEntry) => {
    setOpen(entry)
    setRows((prev) => prev?.map((r) => (r.id === entry.id ? entry : r)) ?? prev)
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoFocus
            aria-label="Поиск по фамилии"
            placeholder="Фамилия"
            className="h-12 pl-10 text-base"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          value={filter}
          onValueChange={(v) => {
            setFilter(v as EntryFilter)
            setQueryParam("filter", v === "all" ? null : v)
          }}
        >
          <SelectTrigger className="h-12 sm:w-56" aria-label="Фильтр участников">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entryFilters(vocabulary).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {rows === null ? (
        !error && <div className="h-40 animate-pulse rounded-xl border border-border bg-muted" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {query || filter !== "all" ? "Никого не нашли." : "Заявок пока нет."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
                  onClick={() => setOpen(r)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{competitorName(r)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[r.clubName, r.divisionName ?? "без категории"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {weightLine(r.declaredWeightKg, r.weighedWeightKg)}
                  </span>
                  <EntryStatusIcon entry={r} coachGen={vocabulary.coach.gen} />
                </button>
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <Button type="button" variant="ghost" className="h-12 w-full" onClick={() => void load(page + 1)}>
              Показать ещё
            </Button>
          )}
        </>
      )}

      <WeighInSheet
        {...ids}
        status={tournament.status}
        entry={open}
        divisions={divisions}
        onClose={() => {
          setOpen(null)
          void load(1)
        }}
        onChanged={changed}
      />
    </div>
  )
}

// The marker the volunteer scans for: weighed and fits, off weight, waits
// for the scale, waits for the coach, withdrawn — icon + colour + a label.
function EntryStatusIcon({ entry, coachGen }: { entry: TournamentEntry; coachGen: string }) {
  const [Icon, label, tone] =
    entry.status === "WITHDRAWN"
      ? [UserX, "Снят", "text-muted-foreground"]
      : entry.status === "DECLARED"
        ? [Clock, `Ждёт ${coachGen}`, "text-muted-foreground"]
        : entry.weighedWeightKg == null
          ? [Circle, "Не взвешен", "text-muted-foreground"]
          : entry.fits === false || entry.divisionId === null
            ? [AlertTriangle, entry.divisionId === null ? "Без категории" : "Не в весе", "text-amber-600"]
            : [CheckCircle2, "В весе", "text-emerald-600"]
  return (
    <span className={`flex w-28 shrink-0 items-center justify-end gap-1.5 text-xs ${tone}`}>
      <Icon className="size-4" aria-hidden />
      {label}
    </span>
  )
}
