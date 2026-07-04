"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import {
  createRankLadder,
  createRankLevel,
  deleteRankLadder,
  deleteRankLevel,
  listRankLadders,
  updateRankLadder,
  type RankLadder,
} from "../../../../../shared/api/ranks"
import { errorMessage } from "../../../../../shared/lib/error-message"

const inputCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"

export default function WorkspaceRanksPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [ladders, setLadders] = useState<RankLadder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ladderName, setLadderName] = useState("")
  const [audience, setAudience] = useState("")

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listRankLadders({ workspaceId, includeInactive: true })
      setLadders(res.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить лестницы"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const addLadder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || !ladderName.trim()) return
    try {
      await createRankLadder({
        workspaceId,
        data: { name: ladderName.trim(), audience: audience.trim() || undefined },
      })
      setLadderName("")
      setAudience("")
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось создать лестницу"))
    }
  }

  const wrap = (fn: () => Promise<unknown>) => async () => {
    if (!workspaceId) return
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errorMessage(e, "Ошибка"))
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ранги и пояса</h1>
        <p className="text-sm text-muted-foreground">
          Настройте лестницы рангов клуба (напр. «Взрослые» и «Дети»). Ранг
          участнику присваивается на его странице в разделе «Участники».
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form
        onSubmit={addLadder}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/40 p-4"
      >
        <input
          className={inputCls}
          placeholder="Название лестницы (напр. «Взрослые»)"
          value={ladderName}
          onChange={(e) => setLadderName(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Аудитория (adult / kids)"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        />
        <Button type="submit" disabled={!ladderName.trim()}>
          Добавить лестницу
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : ladders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Лестниц пока нет.</p>
      ) : (
        <div className="space-y-4">
          {ladders.map((ladder) => (
            <LadderCard
              key={ladder.id}
              workspaceId={workspaceId!}
              ladder={ladder}
              onArchive={wrap(() =>
                updateRankLadder({
                  workspaceId: workspaceId!,
                  ladderId: ladder.id,
                  data: { isActive: !ladder.isActive },
                }),
              )}
              onDelete={wrap(async () => {
                if (!window.confirm(`Удалить лестницу «${ladder.name}»?`)) return
                await deleteRankLadder({ workspaceId: workspaceId!, ladderId: ladder.id })
              })}
              onReload={load}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LadderCard({
  workspaceId,
  ladder,
  onArchive,
  onDelete,
  onReload,
  onError,
}: {
  workspaceId: string
  ladder: RankLadder
  onArchive: () => void
  onDelete: () => void
  onReload: () => Promise<void>
  onError: (m: string) => void
}) {
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const [maxStripes, setMaxStripes] = useState("0")

  const addLevel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createRankLevel({
        workspaceId,
        ladderId: ladder.id,
        data: {
          name: name.trim(),
          order: ladder.levels.length,
          color: color.trim() || undefined,
          maxStripes: Number(maxStripes) || 0,
        },
      })
      setName("")
      setColor("")
      setMaxStripes("0")
      await onReload()
    } catch (e) {
      onError(errorMessage(e, "Не удалось добавить уровень"))
    }
  }

  const removeLevel = async (levelId: string) => {
    try {
      await deleteRankLevel({ workspaceId, ladderId: ladder.id, levelId })
      await onReload()
    } catch (e) {
      onError(errorMessage(e, "Не удалось удалить уровень"))
    }
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{ladder.name}</span>
          {ladder.audience && (
            <span className="text-xs text-muted-foreground">
              {ladder.audience}
            </span>
          )}
          {!ladder.isActive && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              В архиве
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onArchive}>
            {ladder.isActive ? "В архив" : "Вернуть"}
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            Удалить
          </Button>
        </div>
      </div>

      <ol className="mt-3 space-y-1">
        {ladder.levels.map((lv) => (
          <li
            key={lv.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full border border-border"
                style={{ backgroundColor: lv.color ?? "transparent" }}
              />
              {lv.order + 1}. {lv.name}
              {lv.maxStripes > 0 ? ` (до ${lv.maxStripes}★)` : ""}
              {!lv.isActive ? " · архив" : ""}
            </span>
            <button
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => void removeLevel(lv.id)}
            >
              Удалить
            </button>
          </li>
        ))}
        {ladder.levels.length === 0 && (
          <li className="text-sm text-muted-foreground">Уровней пока нет.</li>
        )}
      </ol>

      <form onSubmit={addLevel} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className={inputCls}
          placeholder="Уровень (напр. «Синий пояс»)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${inputCls} w-28`}
          placeholder="Цвет"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          className={`${inputCls} w-24`}
          type="number"
          min={0}
          value={maxStripes}
          onChange={(e) => setMaxStripes(e.target.value)}
          title="Макс. полосок"
        />
        <Button type="submit" size="sm" disabled={!name.trim()}>
          + уровень
        </Button>
      </form>
    </div>
  )
}
