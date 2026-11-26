"use client"

import { useMemo, useState } from "react"

import { Button, Input, Label, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"

import type { OrgLadderTemplate } from "../../../shared/api/organizations"
import { createTournamentDivisions, type TournamentDivision } from "../../../shared/api/tournaments"
import { FORM_LIMITS } from "../../../shared/lib/contract-limits"
import { errorMessage } from "../../../shared/lib/error-message"
import { confirmLeave, useDirtyGuard } from "../../../shared/lib/use-dirty-guard"
import { CriteriaFields, EMPTY_CRITERIA, readCriteria, type CriteriaDraft } from "./CriteriaFields"
import { pluralRu } from "../../../shared/lib/plural-ru"
import { divisionPreviewName, parseWeightBands } from "./tournament-view"

const L = FORM_LIMITS.division

// «Добавить категории» (design §7): one set of criteria × a list of weights
// («58 64 70 76 +76») → preview rows → «Создать N категорий». Names are the
// server's (the same rule as the preview).
export function AddDivisionsSheet({
  organizationId,
  tournamentId,
  open,
  templates,
  orgType,
  onClose,
  onCreated,
}: {
  organizationId: string
  tournamentId: string
  open: boolean
  templates: readonly OrgLadderTemplate[]
  orgType: string
  onClose: () => void
  onCreated: (divisions: TournamentDivision[]) => void
}) {
  const [draft, setDraft] = useState<CriteriaDraft>(EMPTY_CRITERIA)
  const [weights, setWeights] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = open && (weights.trim() !== "" || JSON.stringify(draft) !== JSON.stringify(EMPTY_CRITERIA))
  useDirtyGuard(dirty)

  const plan = useMemo(() => {
    const criteria = readCriteria(draft, templates)
    if (!criteria.ok) return { error: criteria.error }
    const parsed = parseWeightBands(weights)
    if ("error" in parsed) return { error: parsed.error }
    const outOfRange = parsed.bands.some((b) =>
      [b.minKg, b.maxKg].some((kg) => kg !== null && (kg < L.weightMinKg.min || kg > L.weightMinKg.max)),
    )
    if (outOfRange) return { error: `Вес от ${L.weightMinKg.min} до ${L.weightMinKg.max} кг` }
    if (parsed.bands.length > L.rows.max) return { error: `Не больше ${L.rows.max} категорий за раз` }
    return {
      rows: parsed.bands.map((band) => ({
        ...criteria.value,
        weightMinKg: band.minKg,
        weightMaxKg: band.maxKg,
        preview: divisionPreviewName({ ...criteria.value, levelLabel: criteria.levelLabel, ...band }),
      })),
    }
  }, [draft, weights, templates])

  const reset = () => {
    setDraft(EMPTY_CRITERIA)
    setWeights("")
    setError(null)
  }

  const close = async () => {
    if (dirty && !(await confirmLeave())) return
    reset()
    onClose()
  }

  const create = async () => {
    if (!plan.rows) return
    setBusy(true)
    setError(null)
    try {
      const res = await createTournamentDivisions({
        organizationId,
        tournamentId,
        rows: plan.rows.map(({ preview: _preview, ...row }) => row),
      })
      reset()
      onCreated(res.data)
    } catch (e) {
      setError(errorMessage(e, "Не удалось создать категории"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && void close()}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Добавить категории</SheetTitle>
          <SheetDescription>Одна категория на каждый вес из списка.</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <CriteriaFields draft={draft} onChange={setDraft} templates={templates} orgType={orgType} />
          <div className="space-y-1.5">
            <Label htmlFor="weights">Веса, кг</Label>
            <Input
              id="weights"
              className="h-12 text-base"
              placeholder="58 64 70 76 +76"
              value={weights}
              onChange={(e) => setWeights(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Пусто — абсолютная категория.</p>
          </div>

          {plan.error ? (
            <p className="text-sm text-destructive">{plan.error}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {plan.rows?.map((r) => (
                <li key={r.preview} className="px-3 py-2">
                  {r.preview}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-auto flex gap-2">
            <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => void close()}>
              Отмена
            </Button>
            <Button type="submit" className="h-12 flex-1" disabled={busy || !plan.rows}>
              {busy
                ? "Создаём…"
                : `Создать ${plan.rows?.length ?? 0} ${pluralRu(plan.rows?.length ?? 0, "категорию", "категории", "категорий")}`}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
