"use client"

import { Button, Label } from "@clubspace/ui-kit/ui"
import { useEffect, useState } from "react"

import {
  getCourseAudience,
  updateCourseAudience,
  updatePlaylist,
  type CourseAudience,
} from "../../../shared/api/playlists"
import { errorMessage } from "../../../shared/lib/error-message"

type Props = {
  workspaceId: string
  courseId: string
  lockedProgression: boolean
  onProgressionSaved: (lockedProgression: boolean) => void
}

type Draft = {
  groupIds: string[]
  // ladderId → minimum levelId ("" = no requirement on that ladder)
  levelByLadder: Record<string, string>
  planIds: string[]
}

const draftFrom = (audience: CourseAudience): Draft => {
  const levelByLadder: Record<string, string> = {}
  for (const ladder of audience.options.ladders) {
    const picked = ladder.levels.find((l) => audience.rankLevelIds.includes(l.id))
    levelByLadder[ladder.id] = picked?.id ?? ""
  }
  return {
    groupIds: audience.groupIds,
    levelByLadder,
    planIds: audience.planIds,
  }
}

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

const chipClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
  }`

// Course editor block «Доступ»: who may watch the course and whether lessons
// open one by one. Self-contained: loads its own options from the audience
// endpoint, so it works for a coach too.
export function CourseAccessCard({
  workspaceId,
  courseId,
  lockedProgression,
  onProgressionSaved,
}: Props) {
  const [audience, setAudience] = useState<CourseAudience | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [progressionSaving, setProgressionSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    getCourseAudience({ workspaceId, playlistId: courseId })
      .then((data) => {
        if (cancelled) return
        setAudience(data)
        setDraft(draftFrom(data))
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Не удалось загрузить настройки доступа."))
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, courseId])

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const saved = await updateCourseAudience({
        workspaceId,
        playlistId: courseId,
        data: {
          groupIds: draft.groupIds,
          rankLevelIds: Object.values(draft.levelByLadder).filter(Boolean),
          planIds: draft.planIds,
        },
      })
      setAudience(saved)
      setDraft(draftFrom(saved))
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить доступ."))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleProgression = async () => {
    setProgressionSaving(true)
    setError(null)
    try {
      const updated = await updatePlaylist({
        workspaceId,
        playlistId: courseId,
        data: { lockedProgression: !lockedProgression },
      })
      onProgressionSaved(updated.lockedProgression)
    } catch (err) {
      setError(errorMessage(err, "Не удалось изменить режим прохождения."))
    } finally {
      setProgressionSaving(false)
    }
  }

  const options = audience?.options
  const orphaned = audience
    ? audience.orphaned.groups + audience.orphaned.rankLevels + audience.orphaned.plans
    : 0
  // Retired ladders, levels and plans stay listed only while selected.
  const ladders =
    options?.ladders.filter(
      (l) => l.isActive || (draft?.levelByLadder[l.id] ?? "") !== "",
    ) ?? []
  const plans =
    options?.plans.filter((p) => p.isActive || draft?.planIds.includes(p.id)) ?? []

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Доступ к курсу</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {audience
              ? (audience.summary ?? "Весь клуб")
              : "Загружаем…"}
          </p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md bg-muted/30 p-3">
        <div>
          <div className="text-sm font-medium">Последовательное прохождение</div>
          <p className="text-xs text-muted-foreground">
            Урок открывается, когда ученик досмотрел предыдущий обязательный
            урок хотя бы на 90%.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={lockedProgression}
          aria-label="Последовательное прохождение"
          onClick={() => void handleToggleProgression()}
          disabled={progressionSaving}
          className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
            lockedProgression ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-0.5 size-4 rounded-full bg-card shadow transition ${
              lockedProgression ? "left-[1.125rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {orphaned > 0 && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Часть ограничений ссылается на удалённые группы, уровни или абонементы
          — по этому условию курс сейчас закрыт для всех учеников. Сохраните
          доступ, чтобы убрать их.
        </p>
      )}

      {options && draft && (
        <>
          <div className="space-y-2">
            <Label>Группы</Label>
            <p className="text-xs text-muted-foreground">
              Курс видят только ученики выбранных групп — остальным он не
              показывается.
            </p>
            {options.groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">В клубе пока нет групп.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {options.groups.map((g) => {
                  const active = draft.groupIds.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setDraft({ ...draft, groupIds: toggle(draft.groupIds, g.id) })
                      }
                      className={chipClass(active)}
                    >
                      {g.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Минимальный уровень</Label>
            <p className="text-xs text-muted-foreground">
              Ученики ниже уровня видят курс с замком и подсказкой, с какого
              уровня он откроется. Несколько систем — достаточно любой.
            </p>
            {ladders.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                В клубе пока нет систем рангов.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ladders.map((ladder) => (
                  <label key={ladder.id} className="space-y-1 text-xs">
                    <span className="text-muted-foreground">{ladder.name}</span>
                    <select
                      aria-label={`Минимальный уровень: ${ladder.name}`}
                      value={draft.levelByLadder[ladder.id] ?? ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          levelByLadder: {
                            ...draft.levelByLadder,
                            [ladder.id]: event.target.value,
                          },
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">Без ограничения</option>
                      {ladder.levels
                        .filter(
                          (l) =>
                            l.isActive || draft.levelByLadder[ladder.id] === l.id,
                        )
                        .map((level) => (
                          <option key={level.id} value={level.id}>
                            с уровня «{level.name}»
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Абонементы</Label>
            <p className="text-xs text-muted-foreground">
              Без выбранного абонемента ученик видит курс с замком.
            </p>
            {plans.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                В клубе пока нет абонементов.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {plans.map((p) => {
                  const active = draft.planIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setDraft({ ...draft, planIds: toggle(draft.planIds, p.id) })
                      }
                      className={chipClass(active)}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "Сохраняем..." : "Сохранить доступ"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
