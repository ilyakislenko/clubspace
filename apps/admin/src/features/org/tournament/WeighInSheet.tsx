"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  moveTournamentEntry,
  recordTournamentWeighIn,
  setTournamentEntryWithdrawn,
  type TournamentDivision,
  type TournamentEntry,
  type TournamentStatus,
  type WeighInResult,
} from "../../../shared/api/tournaments"
import { FORM_LIMITS } from "../../../shared/lib/contract-limits"
import { errorMessage } from "../../../shared/lib/error-message"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../shared/ui/confirm-dialog"
import { competitorName, formatKg, parseKg, weightLine } from "./tournament-view"

const L = FORM_LIMITS.weighIn

// The volunteer's sheet at the scale (design §7): weight prefilled with the
// declared one → «Записать вес»; the verdict line, and when off-weight the
// neighbouring division one tap away. In SETUP only the division select.
export function WeighInSheet({
  organizationId,
  tournamentId,
  status,
  entry,
  divisions,
  onClose,
  onChanged,
}: {
  organizationId: string
  tournamentId: string
  status: TournamentStatus
  // null = closed.
  entry: TournamentEntry | null
  divisions: readonly TournamentDivision[]
  onClose: () => void
  // The entry changed (weighed, moved, withdrawn): lists and counts re-read.
  onChanged: (entry: TournamentEntry) => void
}) {
  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
        {entry && (
          <WeighInBody
            key={entry.id}
            organizationId={organizationId}
            tournamentId={tournamentId}
            status={status}
            initial={entry}
            divisions={divisions}
            onChanged={onChanged}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function WeighInBody({
  organizationId,
  tournamentId,
  status,
  initial,
  divisions,
  onChanged,
}: {
  organizationId: string
  tournamentId: string
  status: TournamentStatus
  initial: TournamentEntry
  divisions: readonly TournamentDivision[]
  onChanged: (entry: TournamentEntry) => void
}) {
  const [entry, setEntry] = useState(initial)
  const vocabulary = useVocabulary()
  const [raw, setRaw] = useState(() => {
    const kg = initial.weighedWeightKg ?? initial.declaredWeightKg
    return kg != null ? formatKg(kg) : ""
  })
  const [verdict, setVerdict] = useState<WeighInResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setEntry(initial), [initial])

  const ids = { organizationId, tournamentId, entryId: entry.id }
  const withdrawn = entry.status === "WITHDRAWN"
  const canWeigh = status === "WEIGH_IN" && !withdrawn
  // Moves: SETUP / WEIGH_IN; RUNNING only between divisions without results.
  const canMove = status !== "FINISHED" && !withdrawn
  const kg = parseKg(raw)
  const weightError =
    raw.trim() === ""
      ? null
      : kg === null || kg < L.weighedKg.min || kg > L.weighedKg.max
        ? `Вес от ${L.weighedKg.min} до ${L.weighedKg.max} кг, с точностью до 0,1`
        : null

  const run = async <R,>(work: () => Promise<R>, fallback: string): Promise<R | null> => {
    setBusy(true)
    setError(null)
    try {
      return await work()
    } catch (e) {
      setError(errorMessage(e, fallback))
      return null
    } finally {
      setBusy(false)
    }
  }

  const weigh = async () => {
    if (kg === null || weightError) return
    const res = await run(() => recordTournamentWeighIn({ ...ids, weighedKg: kg }), "Не удалось записать вес")
    if (!res) return
    setVerdict(res)
    setEntry(res.entry)
    onChanged(res.entry)
  }

  const move = async (divisionId: string) => {
    if (divisionId === entry.divisionId) return
    const target = divisions.find((d) => d.id === divisionId)
    if (status === "RUNNING") {
      const ok = await confirmDialog({
        title: `Перевести в «${target?.name ?? "другую категорию"}»?`,
        description: "Сетки обеих категорий нужно будет собрать заново.",
        confirmLabel: "Перевести",
      })
      if (!ok) return
    }
    const moved = await run(() => moveTournamentEntry({ ...ids, divisionId }), "Не удалось перевести")
    if (!moved) return
    setVerdict(null)
    setEntry(moved)
    onChanged(moved)
  }

  const setWithdrawn = async (next: boolean) => {
    if (next) {
      const ok = await confirmDialog({
        // A name isn't declined, and a hidden person has none: the title says «участника».
        title: "Снять участника с турнира?",
        description: `${entry.hidden ? "Участник" : competitorName(entry)} не попадёт в сетку. Если сетка категории уже собрана, её соберут заново. Вернуть можно, пока в категории нет результатов.`,
        confirmLabel: "Снять с турнира",
        destructive: true,
      })
      if (!ok) return
    }
    const res = await run(
      () => setTournamentEntryWithdrawn({ ...ids, withdrawn: next }),
      next ? "Не удалось снять участника" : "Не удалось вернуть участника",
    )
    if (!res) return
    setVerdict(null)
    setEntry(res)
    onChanged(res)
  }

  const suggested = verdict?.suggestedDivisionId ? verdict : null
  const facts = [
    entry.clubName,
    `${entry.sex === "MALE" ? "мужской" : "женский"} пол, ${entry.birthYear} г. р.`,
    entry.levelName,
    entry.declaredWeightKg != null ? `заявленный вес ${formatKg(entry.declaredWeightKg)} кг` : null,
  ].filter(Boolean)

  return (
    <>
      <SheetHeader>
        <SheetTitle>{competitorName(entry)}</SheetTitle>
        <SheetDescription>{facts.join(" · ")}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5">
        {withdrawn && (
          <p className="text-sm text-muted-foreground">
            Заявка снята{entry.withdrawnReason ? `: ${entry.withdrawnReason}` : ""}.
          </p>
        )}
        {entry.status === "DECLARED" && (
          <p className="text-sm text-muted-foreground">
            Заявку ещё не подтвердил {vocabulary.coach.nom} клуба — взвешивание подтвердит её.
          </p>
        )}

        {canWeigh && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void weigh()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="weighed-kg">Вес на весах, кг</Label>
              <Input
                id="weighed-kg"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                className="h-14 text-2xl tabular-nums"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
              {weightError && <p className="text-sm text-destructive">{weightError}</p>}
            </div>
            <Button
              type="submit"
              variant={suggested ? "outline" : "default"}
              className="h-12 w-full text-base"
              disabled={busy || kg === null || weightError !== null}
            >
              Записать вес
            </Button>
          </form>
        )}

        {verdict && (
          <div className="space-y-3" role="status">
            <p className={verdict.fits ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-amber-700"}>
              {verdictText(verdict)}
            </p>
            {suggested && (
              <Button
                type="button"
                className="h-12 w-full text-base"
                disabled={busy}
                onClick={() => void move(suggested.suggestedDivisionId as string)}
              >
                Перевести в «{suggested.suggestedDivisionName}»
              </Button>
            )}
          </div>
        )}

        {!verdict && entry.weighedWeightKg != null && (
          <p className="text-sm text-muted-foreground">
            Взвешен: {weightLine(entry.declaredWeightKg, entry.weighedWeightKg)}
            {entry.fits === false && entry.divisionName ? ` — не в весе для «${entry.divisionName}»` : ""}
          </p>
        )}

        {canMove && divisions.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="entry-division">{status === "SETUP" ? "Категория" : "Другая категория"}</Label>
            <Select value={entry.divisionId ?? ""} onValueChange={(v) => void move(v)} disabled={busy}>
              <SelectTrigger id="entry-division" className="h-12">
                <SelectValue placeholder="Без категории" />
              </SelectTrigger>
              <SelectContent>
                {divisions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {status !== "FINISHED" && status !== "RUNNING" && (
          <Button
            type="button"
            variant="ghost"
            className={withdrawn ? "mt-auto h-12" : "mt-auto h-12 text-destructive hover:text-destructive"}
            disabled={busy}
            onClick={() => void setWithdrawn(!withdrawn)}
          >
            {withdrawn ? "Вернуть в турнир" : "Снять с турнира"}
          </Button>
        )}
      </div>
    </>
  )
}

// «Подходит: до 76 кг» / «Не в весе для «до 76 кг»» / no division yet.
export const verdictText = (v: WeighInResult): string => {
  const division = v.entry.divisionName
  if (!division) return "Категория не назначена"
  return v.fits ? `Подходит: ${division}` : `Не в весе для «${division}»`
}
