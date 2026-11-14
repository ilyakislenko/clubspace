"use client"

import { MoreHorizontal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import {
  deleteAchievement,
  listAchievements,
  reorderAchievements,
  seedDefaultAchievements,
  updateAchievement,
  type Achievement,
} from "../../shared/api/achievements"
import { errorMessage } from "../../shared/lib/error-message"
import { pluralRu } from "../../shared/lib/plural-ru"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { DirectionChip } from "../directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  matchesDirectionFilter,
} from "../directions/DirectionFilter"
import { useDirections } from "../directions/use-directions"
import { AchievementFormSheet } from "./AchievementFormSheet"

// «Приложение учеников → Достижения»: the badges members unlock in the app.
export function AchievementsSettings({ workspaceId }: { workspaceId: string }) {
  const session = useVocabulary().session
  const { directions } = useDirections(workspaceId)
  const [items, setItems] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Achievement | null>(null)

  const load = useCallback(async () => {
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

  const visibleItems = items.filter((a) =>
    matchesDirectionFilter(directionFilter, a.directionId),
  )
  // The server seeds a scope (the club or one direction) only while it has no
  // achievements, so only those scopes are offered.
  const freeScopes = [
    { id: null, name: "Весь клуб" },
    ...directions.filter((d) => d.isActive),
  ].filter((scope) => !items.some((a) => (a.directionId ?? null) === scope.id))
  const defaults = `1 / 10 / 25 / 50 / 100 / 200 / 365 ${session.genPl}`

  const openSheet = (a: Achievement | null) => {
    setError(null)
    setEditing(a)
    setSheetOpen(true)
  }

  const run = async (action: () => Promise<void>, failText: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err, failText))
    } finally {
      setBusy(false)
    }
  }

  const seed = (directionId: string | null) =>
    run(async () => {
      setItems((await seedDefaultAchievements({ workspaceId, directionId })).data)
    }, "Не удалось добавить набор по умолчанию")

  // Moves within the visible (possibly direction-filtered) list: swaps the row
  // with its visible neighbour in the club-wide order.
  const move = (a: Achievement, dir: -1 | 1) => {
    const neighbour = visibleItems[visibleItems.indexOf(a) + dir]
    if (!neighbour) return
    const reordered = [...items]
    const i = items.indexOf(a)
    const j = items.indexOf(neighbour)
    ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
    const prev = items
    setItems(reordered) // optimistic
    void run(async () => {
      try {
        const res = await reorderAchievements({ workspaceId, ids: reordered.map((x) => x.id) })
        setItems(res.data)
      } catch (err) {
        setItems(prev)
        throw err
      }
    }, "Не удалось изменить порядок")
  }

  const toggleActive = (a: Achievement) =>
    run(async () => {
      await updateAchievement({
        workspaceId,
        achievementId: a.id,
        data: { isActive: !a.isActive },
      })
      await load()
    }, "Не удалось изменить статус")

  const remove = (a: Achievement) => {
    if (!window.confirm(`Удалить достижение «${a.name}»?`)) return
    void run(async () => {
      await deleteAchievement({ workspaceId, achievementId: a.id })
      await load()
    }, "Не удалось удалить достижение")
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Достижения</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Бейджи, которые ученики открывают за {session.nomPl}: за общее число{" "}
            {session.genPl} или за серию недель подряд.
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => openSheet(null)}>
          Новое достижение
        </Button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg border border-border bg-muted" />
      ) : (
        <>
          {items.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Пока используется набор по умолчанию ({defaults}). Как только вы
              добавите своё достижение, ученики увидят ваш список.
            </p>
          )}

          {items.length > 0 && directions.length > 0 && (
            <div className="mt-4 flex justify-end">
              <DirectionFilter
                directions={directions}
                value={directionFilter}
                onChange={setDirectionFilter}
                includeClubOnly
              />
            </div>
          )}
          {items.length > 0 && visibleItems.length === 0 && (
            <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Нет достижений в выбранном направлении.
            </p>
          )}
          {visibleItems.length > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
              {visibleItems.map((a, index) => (
                <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                    onClick={() => openSheet(a)}
                  >
                    <span className="w-8 shrink-0 text-center text-xl">{a.icon ?? "🏅"}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{a.name}</span>
                        <DirectionChip
                          direction={directions.find((d) => d.id === a.directionId)}
                        />
                        {!a.isActive && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                            Выключено
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {a.metric === "STREAK"
                          ? `${a.threshold} ${pluralRu(a.threshold, "неделя", "недели", "недель")} подряд`
                          : `≥ ${a.threshold} ${session.genPl} всего`}
                        {a.description ? ` · ${a.description}` : ""} · открыли:{" "}
                        {a.unlockedBy}
                      </span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Действия: ${a.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={index === 0} onSelect={() => move(a, -1)}>
                        Выше
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === visibleItems.length - 1}
                        onSelect={() => move(a, 1)}
                      >
                        Ниже
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void toggleActive(a)}>
                        {a.isActive ? "Выключить" : "Включить"}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => remove(a)}>
                        Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}

          {freeScopes.length > 0 &&
            (freeScopes.length === 1 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-3"
                disabled={busy}
                onClick={() => void seed(freeScopes[0].id)}
              >
                Добавить набор по умолчанию
                {freeScopes[0].id ? ` для «${freeScopes[0].name}»` : ""}
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="ghost" className="mt-3" disabled={busy}>
                    Добавить набор по умолчанию…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {freeScopes.map((scope) => (
                    <DropdownMenuItem key={scope.id ?? "club"} onSelect={() => void seed(scope.id)}>
                      {scope.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
        </>
      )}

      <AchievementFormSheet
        workspaceId={workspaceId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        achievement={editing}
        directions={directions}
        onSaved={() => void load()}
      />
    </div>
  )
}
