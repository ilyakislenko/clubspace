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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  createAchievement,
  updateAchievement,
  type Achievement,
  type AchievementInput,
  type AchievementMetric,
} from "../../shared/api/achievements"
import type { Direction } from "../../shared/api/directions"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { DirectionSelect } from "../directions/DirectionSelect"

const L = FORM_LIMITS.achievement

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = create mode.
  achievement: Achievement | null
  directions: Direction[]
  onSaved: () => void
}

export function AchievementFormSheet({
  workspaceId,
  open,
  onOpenChange,
  achievement,
  directions,
  onSaved,
}: Props) {
  const session = useVocabulary().session
  const isCreate = !achievement
  const [name, setName] = useState("")
  const [icon, setIcon] = useState("")
  const [description, setDescription] = useState("")
  const [metric, setMetric] = useState<AchievementMetric>("CHECKINS")
  const [threshold, setThreshold] = useState("10")
  const [directionId, setDirectionId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Re-initialise every time the sheet opens, from the edited row or blank.
  useEffect(() => {
    if (!open) return
    setName(achievement?.name ?? "")
    setIcon(achievement?.icon ?? "")
    setDescription(achievement?.description ?? "")
    setMetric(achievement?.metric ?? "CHECKINS")
    setThreshold(String(achievement?.threshold ?? 10))
    setDirectionId(achievement?.directionId ?? null)
    setError("")
  }, [open, achievement])

  const parsedThreshold = parseIntInput(threshold, L.threshold)

  const handleSubmit = async () => {
    if (!name.trim()) return
    if (parsedThreshold === null) {
      setError(
        `Порог — целое число от ${L.threshold.min} до ${L.threshold.max.toLocaleString("ru-RU")}`,
      )
      return
    }
    setSaving(true)
    setError("")
    const data: AchievementInput = {
      name: name.trim(),
      description: description.trim() || null,
      icon: icon.trim() || null,
      metric,
      threshold: parsedThreshold,
      directionId,
    }
    try {
      if (achievement) {
        await updateAchievement({ workspaceId, achievementId: achievement.id, data })
      } else {
        await createAchievement({ workspaceId, data: { ...data, isActive: true } })
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить достижение"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Новое достижение" : "Редактировать достижение"}</SheetTitle>
          <SheetDescription>
            Бейдж, который ученик открывает в приложении за {session.nomPl}.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-[80px,1fr]">
            <div className="space-y-2">
              <Label htmlFor="achievement-icon">Эмодзи</Label>
              <Input
                id="achievement-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🥋"
                maxLength={L.icon.max}
                className="text-center text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="achievement-name">Название</Label>
              <Input
                id="achievement-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Железная дисциплина"
                maxLength={L.name.max}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="achievement-metric">Метрика</Label>
              <Select
                value={metric}
                onValueChange={(v) => setMetric(v as AchievementMetric)}
              >
                <SelectTrigger id="achievement-metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHECKINS">Всего {session.genPl}</SelectItem>
                  <SelectItem value="STREAK">Недель подряд (серия)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="achievement-threshold">Порог</Label>
              <Input
                id="achievement-threshold"
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="achievement-description">Описание (необязательно)</Label>
            <Input
              id="achievement-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Короткая подпись под бейджем"
              maxLength={L.description.max}
            />
          </div>

          <DirectionSelect
            id="achievement-direction"
            directions={directions}
            value={directionId}
            onChange={setDirectionId}
            hint={`Достижение направления считает только ${session.nomPl} его групп.`}
          />

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
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim() || parsedThreshold === null}
            >
              {saving ? "Сохраняем…" : isCreate ? "Добавить достижение" : "Сохранить"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
