"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import { listOrgEvents, type OrgLadderTemplate } from "../../../shared/api/organizations"
import {
  assignTournamentMats,
  copyTournamentDivisions,
  listTournamentDivisions,
  type OrgTournament,
  type TournamentDivision,
} from "../../../shared/api/tournaments"
import { errorMessage } from "../../../shared/lib/error-message"
import { AddDivisionsSheet } from "./AddDivisionsSheet"
import { DIVISION_STATE_LABEL } from "./tournament-view"

// «Категории» (design §7): the head coach builds the division list days
// before. Row tap → the division page; one primary «Добавить категории».
export function DivisionsTab({
  tournament,
  templates,
  orgType,
  onChanged,
}: {
  tournament: OrgTournament
  templates: readonly OrgLadderTemplate[]
  orgType: string
  onChanged: () => void
}) {
  const ids = { organizationId: tournament.organizationId, tournamentId: tournament.id }
  const [divisions, setDivisions] = useState<TournamentDivision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [copying, setCopying] = useState(false)
  const [sources, setSources] = useState<{ tournamentId: string; title: string }[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setDivisions((await listTournamentDivisions(ids)).data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить категории"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.organizationId, tournament.id])

  useEffect(() => {
    void load()
  }, [load, tournament.status])

  const editable = tournament.status === "SETUP" || tournament.status === "WEIGH_IN"

  // Other tournaments of the federation, past ones included: the copy source.
  useEffect(() => {
    if (!editable) return
    listOrgEvents({ organizationId: tournament.organizationId, includePast: true })
      .then((res) =>
        setSources(
          res.data.flatMap((e) =>
            e.tournament && e.tournament.id !== tournament.id ? [{ tournamentId: e.tournament.id, title: e.title }] : [],
          ),
        ),
      )
      .catch(() => setSources([]))
  }, [editable, tournament.organizationId, tournament.id])

  const replaced = (list: TournamentDivision[]) => {
    setDivisions(list)
    onChanged()
  }

  const assignMats = async () => {
    setBusy(true)
    try {
      replaced((await assignTournamentMats(ids)).data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось распределить по коврам"))
    } finally {
      setBusy(false)
    }
  }

  const base = `/org/${tournament.organizationId}/events/${tournament.eventId}/tournament/divisions`

  return (
    <div className="space-y-4">
      {(editable || (divisions?.length ?? 0) > 0) && tournament.status !== "FINISHED" && (
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            // The page header's phase button is the filled one once divisions exist.
            <Button
              type="button"
              variant={divisions?.length ? "outline" : "default"}
              className="h-11"
              onClick={() => setAdding(true)}
            >
              Добавить категории
            </Button>
          )}
          {editable && sources.length > 0 && (
            <Button type="button" variant="outline" className="h-11" onClick={() => setCopying(true)}>
              Скопировать из турнира
            </Button>
          )}
          {(divisions?.length ?? 0) > 0 && (
            <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => void assignMats()}>
              Распределить по коврам
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {divisions === null ? (
        !error && <div className="h-40 animate-pulse rounded-xl border border-border bg-muted" />
      ) : divisions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Категорий пока нет.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[1fr_6rem_6rem_6rem] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Категория</span>
            <span>Ковёр</span>
            <span className="text-right">Участников</span>
            <span className="text-right">Сетка</span>
          </div>
          <ul className="divide-y divide-border">
            {divisions.map((d) => (
              <li key={d.id}>
                <Link
                  href={`${base}/${d.id}`}
                  className="grid min-h-12 grid-cols-[1fr_6rem_6rem_6rem] items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
                >
                  <span className="min-w-0 truncate font-medium">{d.name}</span>
                  <span className="text-muted-foreground">{d.mat ? `Ковёр ${d.mat}` : "—"}</span>
                  <span className="text-right tabular-nums">{d.entryCount}</span>
                  <span className="text-right text-muted-foreground">{DIVISION_STATE_LABEL[d.state]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddDivisionsSheet
        {...ids}
        open={adding}
        templates={templates}
        orgType={orgType}
        onClose={() => setAdding(false)}
        onCreated={(list) => {
          setAdding(false)
          replaced(list)
        }}
      />
      <CopyDialog
        open={copying}
        sources={sources}
        onClose={() => setCopying(false)}
        onCopy={async (fromTournamentId) => {
          const res = await copyTournamentDivisions({ ...ids, fromTournamentId })
          setCopying(false)
          replaced(res.data)
        }}
      />
    </div>
  )
}

function CopyDialog({
  open,
  sources,
  onClose,
  onCopy,
}: {
  open: boolean
  sources: readonly { tournamentId: string; title: string }[]
  onClose: () => void
  onCopy: (fromTournamentId: string) => Promise<void>
}) {
  const [from, setFrom] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Скопировать категории</DialogTitle>
          <DialogDescription>Категории и ковры другого турнира добавятся к этим, без участников.</DialogDescription>
        </DialogHeader>
        <Select value={from} onValueChange={setFrom}>
          <SelectTrigger className="h-12" aria-label="Турнир">
            <SelectValue placeholder="Турнир" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.tournamentId} value={s.tournamentId}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={!from || busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onCopy(from)
              } catch (e) {
                setError(errorMessage(e, "Не удалось скопировать категории"))
              } finally {
                setBusy(false)
              }
            }}
          >
            Скопировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
