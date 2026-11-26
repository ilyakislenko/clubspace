"use client"

import { useEffect, useState } from "react"

import { Button, Input, Label, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import {
  getTournamentBracket,
  recordTournamentMatchResult,
  undoTournamentMatchResult,
  type TournamentBracket,
  type TournamentCompetitor,
  type TournamentMatch,
} from "../../../shared/api/tournaments"
import { FORM_LIMITS } from "../../../shared/lib/contract-limits"
import { errorMessage } from "../../../shared/lib/error-message"
import { confirmDialog } from "../../../shared/ui/confirm-dialog"
import { StaleUpdateNotice, isStaleUpdate } from "../../../shared/ui/stale-update-notice"
import { roundLabel } from "./bracket-layout"
import {
  MATCH_METHODS,
  competitorName,
  methodHasNote,
  methodHasScore,
  methodLabel,
  methodShort,
  undoEffectText,
  type MatchWinMethod,
} from "./tournament-view"

const L = FORM_LIMITS.matchResult

export type RecordedMatch = { bracket: TournamentBracket; match: TournamentMatch; winnerName: string }

// The table's sheet (design §7, tablet first): two big winner targets, the
// method as one segmented row, scores only for points/decision, «Записать».
// A decided match opens read-only with «Отменить результат». Self-contained:
// it records, undoes and re-reads the division itself.
export function MatchResultSheet({
  organizationId,
  tournamentId,
  orgType,
  match,
  divisionName,
  rounds,
  canEdit,
  onClose,
  onRecorded,
  onUndone,
}: {
  organizationId: string
  tournamentId: string
  orgType: string
  // null = closed.
  match: TournamentMatch | null
  divisionName: string
  // Rounds of the division (the undo confirm names the next round).
  rounds: number
  // RUNNING: results may be written; otherwise the sheet only shows.
  canEdit: boolean
  onClose: () => void
  onRecorded: (recorded: RecordedMatch) => void
  onUndone: (bracket: TournamentBracket) => void
}) {
  return (
    <Sheet open={match !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-xl">
        {match && (
          <MatchResultBody
            key={match.id}
            organizationId={organizationId}
            tournamentId={tournamentId}
            orgType={orgType}
            initial={match}
            divisionName={divisionName}
            rounds={rounds}
            canEdit={canEdit}
            onRecorded={onRecorded}
            onUndone={onUndone}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

const parseScore = (raw: string): number | null | "bad" => {
  if (raw.trim() === "") return null
  if (!/^\d+$/.test(raw.trim())) return "bad"
  const n = Number(raw)
  return n < L.scoreA.min || n > L.scoreA.max ? "bad" : n
}

function MatchResultBody({
  organizationId,
  tournamentId,
  orgType,
  initial,
  divisionName,
  rounds,
  canEdit,
  onRecorded,
  onUndone,
}: {
  organizationId: string
  tournamentId: string
  orgType: string
  initial: TournamentMatch
  divisionName: string
  rounds: number
  canEdit: boolean
  onRecorded: (recorded: RecordedMatch) => void
  onUndone: (bracket: TournamentBracket) => void
}) {
  const [match, setMatch] = useState(initial)
  const [winner, setWinner] = useState<string | null>(null)
  const [method, setMethod] = useState<MatchWinMethod | null>(null)
  const [scoreA, setScoreA] = useState("")
  const [scoreB, setScoreB] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A 409 STALE_UPDATE: another tablet got there first; `stored` is what it wrote.
  const [stale, setStale] = useState<{ error: unknown; stored: TournamentMatch | null } | null>(null)

  useEffect(() => setMatch(initial), [initial])

  const reread = async (): Promise<TournamentMatch | null> => {
    const bracket = await getTournamentBracket({ organizationId, tournamentId, divisionId: match.divisionId })
    return bracket.matches.find((m) => m.id === match.id) ?? null
  }

  const a = match.entryA
  const b = match.entryB
  const title = `${roundLabel(match.round, rounds)} · ${divisionName}`
  const decided = match.winnerEntryId !== null

  const sA = parseScore(scoreA)
  const sB = parseScore(scoreB)
  const scored = methodHasScore(method)
  const scoreError =
    scored && (sA === "bad" || sB === "bad")
      ? `Счёт — целое число от ${L.scoreA.min} до ${L.scoreA.max}`
      : scored && (sA === null) !== (sB === null)
        ? "Укажите счёт обоих"
        : null
  const ready = winner !== null && method !== null && scoreError === null

  const save = async () => {
    if (!ready || !a || !b || !winner || !method) return
    setBusy(true)
    setError(null)
    try {
      const bracket = await recordTournamentMatchResult({
        organizationId,
        tournamentId,
        matchId: match.id,
        data: {
          winnerEntryId: winner,
          method,
          scoreA: scored && typeof sA === "number" ? sA : null,
          scoreB: scored && typeof sB === "number" ? sB : null,
          note: methodHasNote(method) && note.trim() ? note.trim() : null,
          expectedUpdatedAt: match.updatedAt,
        },
      })
      const saved = bracket.matches.find((m) => m.id === match.id) ?? match
      onRecorded({ bracket, match: saved, winnerName: competitorName(winner === a.entryId ? a : b) })
    } catch (e) {
      if (isStaleUpdate(e)) {
        setStale({ error: e, stored: await reread().catch(() => null) })
      } else {
        setError(errorMessage(e, "Не удалось записать результат"))
      }
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    const winnerSide = match.winnerEntryId === a?.entryId ? a : b
    const ok = await confirmDialog({
      title: "Отменить результат?",
      description: undoEffectText(competitorName(winnerSide), match.round, rounds),
      confirmLabel: "Отменить результат",
      cancelLabel: "Оставить",
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      onUndone(
        await undoTournamentMatchResult({
          organizationId,
          tournamentId,
          matchId: match.id,
          expectedUpdatedAt: match.updatedAt,
        }),
      )
    } catch (e) {
      if (isStaleUpdate(e)) setStale({ error: e, stored: await reread().catch(() => null) })
      // MATCH_UNDO_BLOCKED / TOURNAMENT_PUBLISHED: the server says what to do first.
      else setError(errorMessage(e, "Не удалось отменить результат"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          {competitorName(a)} — {competitorName(b)}
        </SheetDescription>
      </SheetHeader>

      {stale &&
        (stale.stored?.winnerEntryId ? (
          // Another tablet recorded this match first: say so and show what it wrote.
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <p className="font-medium text-destructive">Результат уже записан с другого планшета</p>
            <p>Записано: {resultText(stale.stored, orgType)}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                if (stale.stored) setMatch(stale.stored)
                setStale(null)
              }}
            >
              Обновить
            </Button>
          </div>
        ) : (
          <StaleUpdateNotice
            error={stale.error}
            onReload={async () => {
              const fresh = await reread()
              if (fresh) setMatch(fresh)
              setStale(null)
            }}
          />
        ))}

      {decided ? (
        <div className="flex-1 space-y-4 text-sm">
          <p className="text-base font-medium">{resultText(match, orgType)}</p>
          {error && <ErrorLine text={error} />}
          {canEdit && (
            <Button type="button" variant="outline" className="h-12 w-full text-destructive" disabled={busy} onClick={undo}>
              Отменить результат
            </Button>
          )}
        </div>
      ) : !match.ready || !a || !b ? (
        <p className="text-sm text-muted-foreground">Схватка ещё не готова: ждёт победителя предыдущего круга.</p>
      ) : !canEdit ? (
        <p className="text-sm text-muted-foreground">Результаты записывают, когда турнир идёт.</p>
      ) : (
        <form
          className="flex flex-1 flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Победитель</legend>
            {[a, b].map((side) => (
              <WinnerTarget
                key={side.entryId}
                side={side}
                selected={winner === side.entryId}
                onSelect={() => setWinner(side.entryId)}
              />
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Способ победы</legend>
            <div role="radiogroup" aria-label="Способ победы" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {MATCH_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "min-h-12 rounded-md border px-2 py-2 text-sm leading-tight transition-colors hyphens-auto",
                    method === m ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted/50",
                  )}
                >
                  {methodLabel(m, orgType)}
                </button>
              ))}
            </div>
          </fieldset>

          {scored && (
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <ScoreField id="score-a" label={competitorName(a)} value={scoreA} onChange={setScoreA} />
              <span className="pb-3 text-lg text-muted-foreground">:</span>
              <ScoreField id="score-b" label={competitorName(b)} value={scoreB} onChange={setScoreB} />
              {scoreError && <p className="col-span-3 text-sm text-destructive">{scoreError}</p>}
            </div>
          )}

          {methodHasNote(method) && (
            <div className="space-y-1.5">
              <Label htmlFor="match-note">Приём</Label>
              <Input
                id="match-note"
                className="h-12 text-base"
                value={note}
                maxLength={L.note.max}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          {error && <ErrorLine text={error} />}

          <Button type="submit" className="mt-auto h-12 w-full text-base" disabled={!ready || busy}>
            {busy ? "Записываем…" : "Записать"}
          </Button>
        </form>
      )}
    </>
  )
}

// «Победа: Иванов · По очкам 8:2» — what a decided match holds.
export const resultText = (m: TournamentMatch, orgType: string): string => {
  const side = m.winnerEntryId === m.entryA?.entryId ? "A" : "B"
  const winner = side === "A" ? m.entryA : m.entryB
  // The score (winner's first) or the named technique; the bare method otherwise.
  const scoredResult = methodHasScore(m.method) && m.scoreA !== null && m.scoreB !== null
  const tail = scoredResult || (methodHasNote(m.method) && m.note) ? methodShort(m, side, orgType) : null
  return [`Победа: ${competitorName(winner)}`, m.method ? methodLabel(m.method, orgType) : null, tail]
    .filter(Boolean)
    .join(" · ")
}

function WinnerTarget({
  side,
  selected,
  onSelect,
}: {
  side: TournamentCompetitor
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-14 w-full flex-col items-start justify-center rounded-lg border px-4 py-2 text-left transition-colors",
        selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:bg-muted/50",
      )}
    >
      <span className="text-base font-medium">{competitorName(side)}</span>
      {side.clubName && <span className="text-xs text-muted-foreground">{side.clubName}</span>}
    </button>
  )
}

function ScoreField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="block truncate">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        className="h-12 text-center text-lg tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {text}
    </p>
  )
}
