"use client"

import { useParams } from "next/navigation"
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
  createAchievement,
  deleteAchievement,
  listAchievements,
  reorderAchievements,
  seedDefaultAchievements,
  updateAchievement,
  type Achievement,
  type AchievementInput,
  type AchievementMetric,
} from "../../../../../shared/api/achievements"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  matchesDirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import { DirectionSelect } from "../../../../../features/directions/DirectionSelect"
import { useDirections } from "../../../../../features/directions/use-directions"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"

const METRIC_LABEL: Record<AchievementMetric, string> = {
  CHECKINS: "тренировок всего",
  STREAK: "недель подряд",
}

const emptyForm: AchievementInput = {
  name: "",
  description: "",
  icon: "",
  metric: "CHECKINS",
  threshold: 10,
  isActive: true,
  directionId: null,
}

export default function AchievementsPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  // A direction manager gets only their directions' achievements and may
  // create/seed only inside those directions.
  const scope = useDirectionScope(workspaceId)
  const blankForm: AchievementInput = {
    ...emptyForm,
    directionId: scope.defaultDirectionId,
  }

  const [items, setItems] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<AchievementInput>(blankForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const [seedDirectionId, setSeedDirectionId] = useState<string | null>(
    scope.defaultDirectionId,
  )
  const visibleItems = items.filter((a) =>
    matchesDirectionFilter(directionFilter, a.directionId),
  )
  // The server seeds a scope only while it has no achievements.
  const seedScopeTaken = items.some(
    (a) => (a.directionId ?? null) === seedDirectionId,
  )

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listAchievements({ workspaceId })
      setItems(res.data)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить достижения"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const resetForm = () => {
    setForm(blankForm)
    setEditingId(null)
  }

  const startEdit = (a: Achievement) => {
    setEditingId(a.id)
    setForm({
      name: a.name,
      description: a.description ?? "",
      icon: a.icon ?? "",
      metric: a.metric,
      threshold: a.threshold,
      isActive: a.isActive,
      directionId: a.directionId,
    })
  }

  const submit = async () => {
    if (!workspaceId || saving) return
    if (!form.name.trim() || !form.threshold || form.threshold < 1) {
      setError("Укажите название и порог (положительное число).")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const data: AchievementInput = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        icon: form.icon?.trim() || null,
        metric: form.metric,
        threshold: Math.floor(form.threshold),
        isActive: form.isActive,
        directionId: form.directionId ?? null,
      }
      if (editingId) {
        await updateAchievement({ workspaceId, achievementId: editingId, data })
      } else {
        await createAchievement({ workspaceId, data })
      }
      resetForm()
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить достижение"))
    } finally {
      setSaving(false)
    }
  }

  const importDefaults = async () => {
    if (!workspaceId || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await seedDefaultAchievements({
        workspaceId,
        directionId: seedDirectionId,
      })
      setItems(res.data)
    } catch (err) {
      setError(errorMessage(err, "Не удалось добавить набор по умолчанию"))
    } finally {
      setSaving(false)
    }
  }

  // Moves within the visible (possibly direction-filtered) list: swaps the row
  // with its visible neighbour in the club-wide order.
  const move = async (a: Achievement, dir: -1 | 1) => {
    if (!workspaceId) return
    const neighbour = visibleItems[visibleItems.indexOf(a) + dir]
    if (!neighbour) return
    const i = items.indexOf(a)
    const j = items.indexOf(neighbour)
    const reordered = [...items]
    ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
    const prev = items
    setItems(reordered) // optimistic
    try {
      const res = await reorderAchievements({
        workspaceId,
        ids: reordered.map((a) => a.id),
      })
      setItems(res.data)
    } catch (err) {
      setItems(prev)
      setError(errorMessage(err, "Не удалось изменить порядок"))
    }
  }

  const toggleActive = async (a: Achievement) => {
    if (!workspaceId) return
    try {
      await updateAchievement({
        workspaceId,
        achievementId: a.id,
        data: { isActive: !a.isActive },
      })
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось изменить статус"))
    }
  }

  const remove = async (a: Achievement) => {
    if (!workspaceId) return
    if (!window.confirm(`Удалить достижение «${a.name}»?`)) return
    try {
      await deleteAchievement({ workspaceId, achievementId: a.id })
      if (editingId === a.id) resetForm()
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить достижение"))
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Достижения</h1>
        <p className="text-sm text-muted-foreground">
          Настройте бейджи, которые участники открывают за {vocabulary.session.nomPl}. Метрика —
          общее число {vocabulary.session.genPl} или серия недель подряд.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && (items.length === 0 || directions.length > 0) && (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          <p>
            {items.length === 0 && scope.isAdmin
              ? `Пока используется набор по умолчанию (1 / 10 / 25 / 50 / 100 / 200 / 365 ${vocabulary.session.genPl}). Как только вы добавите своё достижение — участники увидят именно ваш список.`
              : `Набор по умолчанию (1 / 10 / 25 / 50 / 100 / 200 / 365 ${vocabulary.session.genPl}) можно добавить для всего клуба или для направления — тогда считаются только ${vocabulary.session.nomPl} этого направления.`}
          </p>
          {directions.length > 0 && (
            <div className="max-w-xs">
              <DirectionSelect
                id="achievement-seed-direction"
                label="Для кого"
                directions={directions}
                value={seedDirectionId}
                onChange={setSeedDirectionId}
                allowedIds={scope.allowedDirectionIds}
                triggerClassName="h-9"
              />
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || seedScopeTaken}
            onClick={() => void importDefaults()}
          >
            Добавить набор по умолчанию
          </Button>
          {seedScopeTaken && (
            <p className="text-xs">
              Здесь уже есть достижения — набор по умолчанию не добавится.
            </p>
          )}
        </div>
      )}

      {/* Create / edit form */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="font-medium">
          {editingId ? "Редактировать достижение" : "Новое достижение"}
        </div>
        <div className="grid gap-3 sm:grid-cols-[80px,1fr]">
          <div>
            <label className="text-xs text-muted-foreground">Эмодзи</label>
            <Input
              value={form.icon ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              placeholder="🥋"
              maxLength={8}
              className="h-9 text-center text-lg"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Название</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Например: Железная дисциплина"
              className="h-9"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Метрика</label>
            <Select
              value={form.metric}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, metric: v as AchievementMetric }))
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CHECKINS">Всего {vocabulary.session.genPl}</SelectItem>
                <SelectItem value="STREAK">Недель подряд (серия)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Порог</label>
            <Input
              type="number"
              min={1}
              value={form.threshold}
              onChange={(e) =>
                setForm((f) => ({ ...f, threshold: Number(e.target.value) }))
              }
              className="h-9"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            Описание (необязательно)
          </label>
          <Input
            value={form.description ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="Короткая подпись под бейджем"
            className="h-9"
          />
        </div>
        <DirectionSelect
          id="achievement-direction"
          directions={directions}
          value={form.directionId ?? null}
          onChange={(directionId) => setForm((f) => ({ ...f, directionId }))}
          allowedIds={scope.allowedDirectionIds}
          triggerClassName="h-9"
          hint={`Достижение направления считает только ${vocabulary.session.nomPl} его групп.`}
        />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={saving} onClick={() => void submit()}>
            {saving ? "Сохраняем…" : editingId ? "Сохранить" : "Добавить"}
          </Button>
          {editingId && (
            <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
              Отмена
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {items.length > 0 && directions.length > 0 && (
        <div className="flex justify-end">
          <DirectionFilter
            directions={scope.filterOptions(directions)}
            value={directionFilter}
            onChange={setDirectionFilter}
            includeClubOnly={scope.isAdmin}
          />
        </div>
      )}
      {items.length > 0 && visibleItems.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Нет достижений в выбранном направлении.
        </p>
      )}
      {visibleItems.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visibleItems.map((a, index) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    aria-label="Выше"
                    disabled={index === 0}
                    onClick={() => void move(a, -1)}
                    className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label="Ниже"
                    disabled={index === visibleItems.length - 1}
                    onClick={() => void move(a, 1)}
                    className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <span className="w-8 shrink-0 text-center text-xl">
                  {a.icon ?? "🏅"}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-sm font-medium">
                    <span className="truncate">{a.name}</span>
                    <DirectionChip
                      direction={directions.find((d) => d.id === a.directionId)}
                    />
                    {!a.isActive && (
                      <span className="text-xs text-muted-foreground">
                        (выключена)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    ≥ {a.threshold} {METRIC_LABEL[a.metric]}
                    {a.description ? ` · ${a.description}` : ""}
                    {" · "}
                    <span className="text-foreground/70">
                      открыли: {a.unlockedBy}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void toggleActive(a)}
                >
                  {a.isActive ? "Выключить" : "Включить"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => startEdit(a)}
                >
                  Изменить
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void remove(a)}
                >
                  Удалить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
