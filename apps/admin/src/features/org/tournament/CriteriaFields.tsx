"use client"

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import type { OrgLadderTemplate } from "../../../shared/api/organizations"
import { FORM_LIMITS } from "../../../shared/lib/contract-limits"
import { levelRangeLabel, levelWord, type CompetitorSex } from "./tournament-view"

const L = FORM_LIMITS.division

// Who a division is for, besides weight: sex, age by birth year, a level range
// of one federation standard. Shared by «Добавить категории» and «Изменить
// категорию».
export type CriteriaDraft = {
  sex: CompetitorSex | null
  ageMin: string
  ageMax: string
  templateId: string | null
  levelOrderFrom: number | null
  levelOrderTo: number | null
}

export const EMPTY_CRITERIA: CriteriaDraft = {
  sex: null,
  ageMin: "",
  ageMax: "",
  templateId: null,
  levelOrderFrom: null,
  levelOrderTo: null,
}

const NO_TEMPLATE = "none"

const SEX_OPTIONS: readonly { value: CompetitorSex | null; label: string }[] = [
  { value: "MALE", label: "Мужчины" },
  { value: "FEMALE", label: "Женщины" },
  { value: null, label: "Все" },
]

const parseAge = (raw: string): number | null | "bad" => {
  if (raw.trim() === "") return null
  if (!/^\d+$/.test(raw.trim())) return "bad"
  const n = Number(raw)
  return n < L.ageMin.min || n > L.ageMin.max ? "bad" : n
}

// The checked criteria, or the first problem in words.
export const readCriteria = (
  draft: CriteriaDraft,
  templates: readonly OrgLadderTemplate[],
):
  | {
      ok: true
      value: {
        sex: CompetitorSex | null
        ageMin: number | null
        ageMax: number | null
        templateId: string | null
        levelOrderFrom: number | null
        levelOrderTo: number | null
      }
      levelLabel: string | null
    }
  | { ok: false; error: string } => {
  const ageMin = parseAge(draft.ageMin)
  const ageMax = parseAge(draft.ageMax)
  if (ageMin === "bad" || ageMax === "bad") return { ok: false, error: `Возраст от ${L.ageMin.min} до ${L.ageMin.max} лет` }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) return { ok: false, error: "Возраст «от» больше, чем «до»" }
  const template = templates.find((t) => t.id === draft.templateId) ?? null
  let from = template ? draft.levelOrderFrom : null
  let to = template ? draft.levelOrderTo : null
  if (from !== null && to !== null && from > to) [from, to] = [to, from]
  const name = (order: number | null) => template?.levels.find((l) => l.order === order)?.name ?? null
  return {
    ok: true,
    value: { sex: draft.sex, ageMin, ageMax, templateId: template?.id ?? null, levelOrderFrom: from, levelOrderTo: to },
    levelLabel: levelRangeLabel(name(from), name(to)),
  }
}

export function CriteriaFields({
  draft,
  onChange,
  templates,
  orgType,
}: {
  draft: CriteriaDraft
  onChange: (next: CriteriaDraft) => void
  templates: readonly OrgLadderTemplate[]
  orgType: string
}) {
  const set = (patch: Partial<CriteriaDraft>) => onChange({ ...draft, ...patch })
  const template = templates.find((t) => t.id === draft.templateId) ?? null
  const levels = [...(template?.levels ?? [])].sort((a, b) => a.order - b.order)
  const word = levelWord(orgType)

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Пол</legend>
        <div role="radiogroup" aria-label="Пол" className="grid grid-cols-3 gap-2">
          {SEX_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={draft.sex === o.value}
              onClick={() => set({ sex: o.value })}
              className={cn(
                "min-h-12 rounded-md border text-sm transition-colors",
                draft.sex === o.value ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted/50",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="age-min">Возраст от</Label>
          <Input id="age-min" inputMode="numeric" className="h-12" value={draft.ageMin} onChange={(e) => set({ ageMin: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="age-max">до, лет</Label>
          <Input id="age-max" inputMode="numeric" className="h-12" value={draft.ageMax} onChange={(e) => set({ ageMax: e.target.value })} />
        </div>
      </div>

      {templates.length > 0 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="template">{word} по стандарту</Label>
            <Select
              value={draft.templateId ?? NO_TEMPLATE}
              onValueChange={(v) =>
                set({ templateId: v === NO_TEMPLATE ? null : v, levelOrderFrom: null, levelOrderTo: null })
              }
            >
              <SelectTrigger id="template" className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>Любой</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {template && levels.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {(["levelOrderFrom", "levelOrderTo"] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={key}>{key === "levelOrderFrom" ? "от" : "до"}</Label>
                  <Select
                    value={draft[key] === null ? "" : String(draft[key])}
                    onValueChange={(v) => set({ [key]: Number(v) })}
                  >
                    <SelectTrigger id={key} className="h-12">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((l) => (
                        <SelectItem key={l.id} value={String(l.order)}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
