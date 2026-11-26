"use client"

import { useState } from "react"

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
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import type { OrgLadderTemplate } from "../../../shared/api/organizations"
import { updateTournamentDivision, type TournamentDivision } from "../../../shared/api/tournaments"
import { FORM_LIMITS } from "../../../shared/lib/contract-limits"
import { errorMessage } from "../../../shared/lib/error-message"
import { confirmLeave, useDirtyGuard } from "../../../shared/lib/use-dirty-guard"
import { StaleUpdateNotice, isStaleUpdate } from "../../../shared/ui/stale-update-notice"
import { CriteriaFields, readCriteria, type CriteriaDraft } from "./CriteriaFields"
import { formatKg, parseKg } from "./tournament-view"

const L = FORM_LIMITS.division
const NO_MAT = "none"

type Draft = { name: string; criteria: CriteriaDraft; weightMin: string; weightMax: string; mat: number | null }

const draftOf = (d: TournamentDivision): Draft => ({
  name: d.name,
  criteria: {
    sex: d.sex,
    ageMin: d.ageMin?.toString() ?? "",
    ageMax: d.ageMax?.toString() ?? "",
    templateId: d.templateId,
    levelOrderFrom: d.levelOrderFrom,
    levelOrderTo: d.levelOrderTo,
  },
  weightMin: d.weightMinKg != null ? formatKg(d.weightMinKg) : "",
  weightMax: d.weightMaxKg != null ? formatKg(d.weightMaxKg) : "",
  mat: d.mat,
})

// «Изменить категорию» (design §7): the side panel of one division, with a
// dirty guard and the version it opened with.
export function DivisionSheet({
  organizationId,
  tournamentId,
  division,
  matCount,
  templates,
  orgType,
  onClose,
  onSaved,
  onReload,
}: {
  organizationId: string
  tournamentId: string
  // null = closed.
  division: TournamentDivision | null
  matCount: number
  templates: readonly OrgLadderTemplate[]
  orgType: string
  onClose: () => void
  onSaved: (division: TournamentDivision) => void
  onReload: () => Promise<TournamentDivision | null>
}) {
  return (
    <Sheet open={division !== null} onOpenChange={(open) => !open && void (async () => (await confirmLeave()) && onClose())()}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
        {division && (
          <DivisionForm
            key={division.id}
            organizationId={organizationId}
            tournamentId={tournamentId}
            division={division}
            matCount={matCount}
            templates={templates}
            orgType={orgType}
            onCancel={async () => (await confirmLeave()) && onClose()}
            onSaved={onSaved}
            onReload={onReload}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function DivisionForm({
  organizationId,
  tournamentId,
  division,
  matCount,
  templates,
  orgType,
  onCancel,
  onSaved,
  onReload,
}: {
  organizationId: string
  tournamentId: string
  division: TournamentDivision
  matCount: number
  templates: readonly OrgLadderTemplate[]
  orgType: string
  onCancel: () => void
  onSaved: (division: TournamentDivision) => void
  onReload: () => Promise<TournamentDivision | null>
}) {
  const [opened, setOpened] = useState(() => ({ draft: draftOf(division), version: division.updatedAt }))
  const [draft, setDraft] = useState<Draft>(opened.draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useDirtyGuard(JSON.stringify(draft) !== JSON.stringify(opened.draft))

  const weight = (raw: string): number | null | "bad" => {
    if (raw.trim() === "") return null
    const kg = parseKg(raw)
    return kg === null || kg < L.weightMinKg.min || kg > L.weightMinKg.max ? "bad" : kg
  }
  const criteria = readCriteria(draft.criteria, templates)
  const wMin = weight(draft.weightMin)
  const wMax = weight(draft.weightMax)
  const problem = !draft.name.trim()
    ? "Укажите название"
    : !criteria.ok
      ? criteria.error
      : wMin === "bad" || wMax === "bad"
        ? `Вес от ${L.weightMinKg.min} до ${L.weightMinKg.max} кг`
        : wMin !== null && wMax !== null && wMin >= wMax
          ? "Вес «свыше» должен быть меньше, чем «до»"
          : null

  const save = async () => {
    if (problem || !criteria.ok || wMin === "bad" || wMax === "bad") return
    setBusy(true)
    setError(null)
    try {
      const saved = await updateTournamentDivision({
        organizationId,
        tournamentId,
        divisionId: division.id,
        data: {
          name: draft.name.trim(),
          ...criteria.value,
          weightMinKg: wMin,
          weightMaxKg: wMax,
          mat: draft.mat,
          expectedUpdatedAt: opened.version,
        },
      })
      setOpened({ draft, version: saved.updatedAt })
      onSaved(saved)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Изменить категорию</SheetTitle>
      </SheetHeader>
      <form
        className="flex flex-1 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="division-name">Название</Label>
          <Input
            id="division-name"
            className="h-12"
            value={draft.name}
            maxLength={L.name.max}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <CriteriaFields
          draft={draft.criteria}
          onChange={(c) => setDraft({ ...draft, criteria: c })}
          templates={templates}
          orgType={orgType}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="weight-min">Вес свыше, кг</Label>
            <Input
              id="weight-min"
              inputMode="decimal"
              className="h-12"
              value={draft.weightMin}
              onChange={(e) => setDraft({ ...draft, weightMin: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weight-max">до, кг</Label>
            <Input
              id="weight-max"
              inputMode="decimal"
              className="h-12"
              value={draft.weightMax}
              onChange={(e) => setDraft({ ...draft, weightMax: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="division-mat">Ковёр</Label>
          <Select
            value={draft.mat === null ? NO_MAT : String(draft.mat)}
            onValueChange={(v) => setDraft({ ...draft, mat: v === NO_MAT ? null : Number(v) })}
          >
            <SelectTrigger id="division-mat" className="h-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_MAT}>Не назначен</SelectItem>
              {Array.from({ length: matCount }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Ковёр {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {error !== null &&
          (isStaleUpdate(error) ? (
            <StaleUpdateNotice
              error={error}
              onReload={async () => {
                const fresh = await onReload()
                if (!fresh) return
                const next = draftOf(fresh)
                setOpened({ draft: next, version: fresh.updatedAt })
                setDraft(next)
                setError(null)
              }}
            />
          ) : (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage(error, "Не удалось сохранить категорию")}
            </p>
          ))}

        <div className="mt-auto flex gap-2">
          <Button type="button" variant="outline" className="h-12 flex-1" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" className="h-12 flex-1" disabled={busy || problem !== null}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
      </form>
    </>
  )
}
