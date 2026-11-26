"use client"

import { ChevronLeft, MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import { listOrgLadderTemplates, type OrgLadderTemplate } from "../../../../../../../../../shared/api/organizations"
import {
  deleteTournamentDivision,
  drawTournamentDivision,
  getTournamentBracket,
  type OrgTournament,
  type TournamentBracket,
  type TournamentMatch,
} from "../../../../../../../../../shared/api/tournaments"
import { errorMessage } from "../../../../../../../../../shared/lib/error-message"
import { confirmDialog } from "../../../../../../../../../shared/ui/confirm-dialog"
import { useOrg } from "../../../../../../../../../features/org/org-context"
import { Bracket } from "../../../../../../../../../features/org/tournament/Bracket"
import { DivisionSheet } from "../../../../../../../../../features/org/tournament/DivisionSheet"
import { MatchResultSheet } from "../../../../../../../../../features/org/tournament/MatchResultSheet"
import {
  DIVISION_STATE_LABEL,
  competitorName,
  entriesCount,
} from "../../../../../../../../../features/org/tournament/tournament-view"
import { useResultToast } from "../../../../../../../../../features/org/tournament/use-result-toast"
import { useEventTournament, useVisiblePoll } from "../../../../../../../../../features/org/tournament/use-tournament"

const POLL_MS = 10_000

// One division (design §7): before the draw its athletes, after it the
// bracket; tap a ready or decided match to record or see it. Polls every
// 10 s while the tournament runs.
export default function TournamentDivisionPage() {
  const { org } = useOrg()
  const params = useParams<{ eventId: string; divisionId: string }>()
  const eventId = params?.eventId ?? ""
  const divisionId = params?.divisionId ?? ""
  const { state, reload } = useEventTournament(org.id, eventId)
  if (state.kind === "loading") return <div className="h-40 max-w-5xl animate-pulse rounded-xl border border-border bg-muted" />
  if (state.kind !== "ready") {
    return (
      <div className="max-w-3xl space-y-3 rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        <p>{state.kind === "missing" ? "У этого события нет турнира." : state.message}</p>
        <Link href={`/org/${org.id}/events`} className="font-medium text-foreground underline underline-offset-4">
          К календарю
        </Link>
      </div>
    )
  }
  return (
    <DivisionView
      tournament={state.tournament}
      divisionId={divisionId}
      orgType={org.type}
      onTournamentChanged={() => void reload()}
    />
  )
}

function DivisionView({
  tournament,
  divisionId,
  orgType,
  onTournamentChanged,
}: {
  tournament: OrgTournament
  divisionId: string
  orgType: string
  onTournamentChanged: () => void
}) {
  const router = useRouter()
  const ids = { organizationId: tournament.organizationId, tournamentId: tournament.id }
  const [bracket, setBracket] = useState<TournamentBracket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<TournamentMatch | null>(null)
  const [editing, setEditing] = useState(false)
  const [templates, setTemplates] = useState<OrgLadderTemplate[]>([])

  const load = useCallback(async () => {
    try {
      setBracket(await getTournamentBracket({ ...ids, divisionId }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить категорию"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.organizationId, tournament.id, divisionId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    listOrgLadderTemplates({ organizationId: tournament.organizationId })
      .then((res) => setTemplates(res.data.filter((t) => t.isActive)))
      .catch(() => setTemplates([]))
  }, [tournament.organizationId])

  const running = tournament.status === "RUNNING"
  useVisiblePoll(() => void load(), POLL_MS, running && open === null && !editing)

  const changed = (next: TournamentBracket) => {
    setBracket(next)
    onTournamentChanged()
  }
  const { recorded, toast } = useResultToast(tournament.organizationId, tournament.id, () => {
    void load()
    onTournamentChanged()
  })

  const back = `/org/${tournament.organizationId}/events/${tournament.eventId}/tournament`
  const division = bracket?.division
  const drawable = tournament.status === "WEIGH_IN" || running

  const draw = async (redraw: boolean) => {
    if (
      redraw &&
      !(await confirmDialog({
        title: "Пережеребить?",
        description: "Сетка соберётся заново: пары и свободные проходы изменятся.",
        confirmLabel: "Пережеребить",
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      changed(await drawTournamentDivision({ ...ids, divisionId }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось провести жеребьёвку"))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!division) return
    const ok = await confirmDialog({
      title: `Удалить «${division.name}»?`,
      description: "В категории нет участников.",
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteTournamentDivision({ ...ids, divisionId })
      onTournamentChanged()
      router.push(back)
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить категорию"))
      setBusy(false)
    }
  }

  const menu: { label: string; run: () => void; destructive?: boolean }[] = []
  if (division && tournament.status !== "FINISHED") menu.push({ label: "Изменить категорию", run: () => setEditing(true) })
  if (division && drawable && division.drawnAt && !division.hasResults) {
    menu.push({ label: "Пережеребить", run: () => void draw(true) })
  }
  if (division && tournament.status !== "FINISHED" && division.entryCount === 0) {
    menu.push({ label: "Удалить", run: () => void remove(), destructive: true })
  }

  return (
    <div className="max-w-6xl space-y-6">
      <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {tournament.event.title}
      </Link>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {!bracket || !division ? (
        !error && <div className="h-60 animate-pulse rounded-xl border border-border bg-muted" />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-semibold">{division.name}</h1>
              <p className="text-sm text-muted-foreground">
                {[
                  division.mat ? `Ковёр ${division.mat}` : "Ковёр не назначен",
                  entriesCount(division.entryCount),
                  DIVISION_STATE_LABEL[division.state],
                ].join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {drawable && !division.drawnAt && division.entryCount > 0 && (
                <Button type="button" className="h-11" disabled={busy} onClick={() => void draw(false)}>
                  Жеребьёвка
                </Button>
              )}
              {menu.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Действия с категорией">
                      <MoreHorizontal className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {menu.map((m) => (
                      <DropdownMenuItem
                        key={m.label}
                        className={m.destructive ? "min-h-11 text-destructive" : "min-h-11"}
                        onSelect={m.run}
                      >
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {division.drawnAt ? (
            <Bracket bracket={bracket} orgType={orgType} onSelect={setOpen} />
          ) : bracket.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              В категории пока никого нет.
            </p>
          ) : (
            <ul className="max-w-2xl divide-y divide-border overflow-hidden rounded-xl border border-border">
              {bracket.entries.map((e) => (
                <li key={e.entryId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{competitorName(e)}</span>
                  {e.clubName && <span className="shrink-0 text-xs text-muted-foreground">{e.clubName}</span>}
                </li>
              ))}
            </ul>
          )}

          <MatchResultSheet
            {...ids}
            orgType={orgType}
            match={open}
            divisionName={division.name}
            rounds={bracket.rounds}
            canEdit={running}
            onClose={() => setOpen(null)}
            onRecorded={(r) => {
              setOpen(null)
              setBracket(r.bracket)
              recorded(r)
            }}
            onUndone={(next) => {
              setOpen(null)
              changed(next)
            }}
          />
          <DivisionSheet
            {...ids}
            division={editing ? division : null}
            matCount={tournament.matCount}
            templates={templates}
            orgType={orgType}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              void load()
              onTournamentChanged()
            }}
            onReload={async () => {
              const fresh = await getTournamentBracket({ ...ids, divisionId })
              setBracket(fresh)
              return fresh.division
            }}
          />
          {toast}
        </>
      )}
    </div>
  )
}
