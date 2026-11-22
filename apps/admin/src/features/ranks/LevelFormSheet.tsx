"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"
import { cap, countForm, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import {
  createRankLevel,
  updateRankLevel,
  type RankLevel,
} from "../../shared/api/ranks"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { pluralRu } from "../../shared/lib/plural-ru"
import { useVocabulary } from "../../shared/lib/vocabulary"

const L = FORM_LIMITS.level

// Common belt colours; any CSS colour can still be typed.
const PRESET_COLORS = [
  "#F8FAFC",
  "#9CA3AF",
  "#FACC15",
  "#F97316",
  "#16A34A",
  "#2563EB",
  "#7C3AED",
  "#92400E",
  "#DC2626",
  "#111827",
]

// «Допуск к аттестации» of a level as one line, or null when it has none.
export const describeLevelRule = (
  lv: RankLevel,
  vocabulary: ClubVocabulary,
): string | null => {
  const parts = [
    lv.minVisits != null
      ? `${lv.minVisits} ${countForm(lv.minVisits, vocabulary.session, pluralRu)}`
      : null,
    lv.minWeeks != null
      ? `${lv.minWeeks} ${pluralRu(lv.minWeeks, "неделя", "недели", "недель")}`
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? `допуск: ${parts.join(" и ")}` : null
}

type Props = {
  workspaceId: string
  ladderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = create mode.
  level: RankLevel | null
  // `order` of a new level (after the last one).
  nextOrder: number
  // The «допуск» is the step up to this level: the first level has none.
  withRule: boolean
  onSaved: () => void
}

export function LevelFormSheet({
  workspaceId,
  ladderId,
  open,
  onOpenChange,
  level,
  nextOrder,
  withRule,
  onSaved,
}: Props) {
  const vocabulary = useVocabulary()
  const isCreate = !level
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const [maxStripes, setMaxStripes] = useState("0")
  const [visits, setVisits] = useState("")
  const [weeks, setWeeks] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Re-initialise every time the sheet opens, from the edited level or blank.
  useEffect(() => {
    if (!open) return
    setName(level?.name ?? "")
    setColor(level?.color ?? "")
    setMaxStripes(String(level?.maxStripes ?? 0))
    setVisits(level?.minVisits != null ? String(level.minVisits) : "")
    setWeeks(level?.minWeeks != null ? String(level.minWeeks) : "")
    setError("")
  }, [open, level])

  // Closing with changes asks first (the same prompt as leaving the page).
  const saved = {
    name: level?.name ?? "",
    color: level?.color ?? "",
    maxStripes: String(level?.maxStripes ?? 0),
    visits: level?.minVisits != null ? String(level.minVisits) : "",
    weeks: level?.minWeeks != null ? String(level.minWeeks) : "",
  }
  const dirty = open && !sameData({ name, color, maxStripes, visits, weeks }, saved)
  useDirtyGuard(dirty)
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    const stripes = parseIntInput(maxStripes, L.maxStripes)
    if (stripes === null) {
      setError(`Полоски — целое число от ${L.maxStripes.min} до ${L.maxStripes.max}`)
      return
    }
    const minVisits = visits.trim() ? parseIntInput(visits, L.minVisits) : null
    const minWeeks = weeks.trim() ? parseIntInput(weeks, L.minWeeks) : null
    if (withRule && visits.trim() && minVisits === null) {
      setError(
        `${cap(vocabulary.session.nomPl)} — целое число от ${L.minVisits.min} до ${L.minVisits.max}`,
      )
      return
    }
    if (withRule && weeks.trim() && minWeeks === null) {
      setError(`Недели — целое число от ${L.minWeeks.min} до ${L.minWeeks.max}`)
      return
    }
    setSaving(true)
    setError("")
    const data = {
      name: name.trim(),
      color: color.trim() || null,
      maxStripes: stripes,
      ...(withRule ? { minVisits, minWeeks } : {}),
    }
    try {
      if (level) {
        await updateRankLevel({ workspaceId, ladderId, levelId: level.id, data })
      } else {
        await createRankLevel({
          workspaceId,
          ladderId,
          data: { ...data, order: nextOrder },
        })
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить уровень"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Новый уровень" : "Редактировать уровень"}</SheetTitle>
          <SheetDescription>
            Ступень лестницы: пояс, степень или уровень группы.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="level-name">Название</Label>
            <Input
              id="level-name"
              value={name}
              maxLength={L.name.max}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Синий пояс или Продолжающие"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="level-color">Цвет</Label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Цвет ${c}`}
                  onClick={() => setColor(c)}
                  className={`size-7 rounded-full border-2 ${
                    color.toUpperCase() === c
                      ? "border-foreground"
                      : "border-border"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="level-color"
                value={color}
                maxLength={L.color.max}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#2563EB"
                className="w-32 font-mono"
              />
              {color && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setColor("")}
                >
                  Без цвета
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="level-stripes">Полосок на уровне</Label>
            <Input
              id="level-stripes"
              type="number"
              min={L.maxStripes.min}
              max={L.maxStripes.max}
              value={maxStripes}
              onChange={(e) => setMaxStripes(e.target.value)}
              className="w-28"
            />
          </div>

          {withRule && (
            <div className="space-y-2">
              <Label>Допуск к аттестации</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  inputMode="numeric"
                  aria-label={`Минимум ${vocabulary.session.genPl}`}
                  placeholder={`Минимум ${vocabulary.session.genPl}`}
                  value={visits}
                  onChange={(e) => setVisits(e.target.value)}
                />
                <Input
                  inputMode="numeric"
                  aria-label="Минимум недель"
                  placeholder="Минимум недель"
                  value={weeks}
                  onChange={(e) => setWeeks(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Считается с прошлого повышения. Пустое поле — без требования.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void requestClose()}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim()}
            >
              {saving ? "Сохраняем…" : isCreate ? "Добавить уровень" : "Сохранить"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
