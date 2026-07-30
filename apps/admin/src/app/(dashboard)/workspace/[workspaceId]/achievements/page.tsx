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
} from "@bjj-academy/ui-kit/ui"

import {
  createAchievement,
  deleteAchievement,
  listAchievements,
  updateAchievement,
  type Achievement,
  type AchievementInput,
  type AchievementMetric,
} from "../../../../../shared/api/achievements"
import { errorMessage } from "../../../../../shared/lib/error-message"

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
}

export default function AchievementsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [items, setItems] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<AchievementInput>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listAchievements({ workspaceId })
      setItems(res.data)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить ачивки"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const resetForm = () => {
    setForm(emptyForm)
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
      }
      if (editingId) {
        await updateAchievement({ workspaceId, achievementId: editingId, data })
      } else {
        await createAchievement({ workspaceId, data })
      }
      resetForm()
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить ачивку"))
    } finally {
      setSaving(false)
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
    if (!window.confirm(`Удалить ачивку «${a.name}»?`)) return
    try {
      await deleteAchievement({ workspaceId, achievementId: a.id })
      if (editingId === a.id) resetForm()
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить ачивку"))
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ачивки</h1>
        <p className="text-sm text-muted-foreground">
          Настройте бейджи, которые участники открывают за тренировки. Метрика —
          общее число тренировок или серия недель подряд.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Пока используется набор по умолчанию (1 / 10 / 25 / 50 / 100 / 200 /
          365 тренировок). Как только вы добавите свою ачивку — участники увидят
          именно ваш список.
        </div>
      )}

      {/* Create / edit form */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="font-medium">
          {editingId ? "Редактировать ачивку" : "Новая ачивка"}
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
                <SelectItem value="CHECKINS">Всего тренировок</SelectItem>
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
      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-8 shrink-0 text-center text-xl">
                  {a.icon ?? "🏅"}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {a.name}
                    {!a.isActive && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (выключена)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    ≥ {a.threshold} {METRIC_LABEL[a.metric]}
                    {a.description ? ` · ${a.description}` : ""}
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
