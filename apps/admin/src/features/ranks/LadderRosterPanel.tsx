"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getLadderRoster,
  promoteMembers,
  type LadderRosterEntry,
  type RankLadder,
} from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { RankChip } from "./RankChip"

const displayName = (e: LadderRosterEntry): string =>
  [e.firstname, e.lastname].filter(Boolean).join(" ") || e.email

// Ranks the whole club on one ladder from one screen: everyone rankable with
// their current level, a checkbox each, and one "give this level" action —
// instead of opening every member's profile to promote them one by one.
export function LadderRosterPanel({
  workspaceId,
  ladder,
}: {
  workspaceId: string
  ladder: RankLadder
}) {
  const [roster, setRoster] = useState<LadderRosterEntry[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [levelId, setLevelId] = useState("")
  const [stripes, setStripes] = useState("0")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await getLadderRoster({ workspaceId, ladderId: ladder.id })
      setRoster(res.data)
      // Drop anyone who has left since the list loaded, so a retry after the
      // server's "обновите список" goes through instead of failing again.
      const present = new Set(res.data.map((e) => e.userId))
      setSelected((prev) => new Set([...prev].filter((id) => present.has(id))))
      return true
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить участников"))
      return false
    }
  }, [workspaceId, ladder.id])

  useEffect(() => {
    void load()
  }, [load])

  const levels = useMemo(
    () => ladder.levels.filter((lv) => lv.isActive),
    [ladder.levels],
  )
  // Resolved against the live levels: if the chosen one gets archived while the
  // panel is open, it stops counting as chosen.
  const level = levels.find((lv) => lv.id === levelId)
  const maxStripes = level?.maxStripes ?? 0

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })

  const selectWhere = (pick: (e: LadderRosterEntry) => boolean) =>
    setSelected(new Set((roster ?? []).filter(pick).map((e) => e.userId)))

  const submit = async () => {
    if (!level || selected.size === 0) return
    if (
      !window.confirm(
        `Выдать «${level.name}» ${selected.size} участникам? Каждый получит уведомление.`,
      )
    )
      return
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const res = await promoteMembers({
        workspaceId,
        ladderId: ladder.id,
        data: {
          userIds: [...selected],
          levelId: level.id,
          stripes: Math.max(
            0,
            Math.min(Math.trunc(Number(stripes) || 0), maxStripes),
          ),
          note: note.trim() || undefined,
        },
      })
      setResult(
        res.unchanged > 0
          ? `Выдано: ${res.promoted}. Уже на этом ранге: ${res.unchanged}.`
          : `Выдано: ${res.promoted}.`,
      )
      setSelected(new Set())
      setNote("")
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось выдать ранг"))
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (levels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Добавьте уровни в эту лестницу, чтобы присваивать их участникам.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputCls}
          value={levelId}
          onChange={(e) => {
            setLevelId(e.target.value)
            setStripes("0")
          }}
        >
          <option value="">Уровень…</option>
          {levels.map((lv) => (
            <option key={lv.id} value={lv.id}>
              {lv.name}
            </option>
          ))}
        </select>
        {maxStripes > 0 && (
          <input
            className={`${inputCls} w-20`}
            type="number"
            min={0}
            max={maxStripes}
            value={stripes}
            onChange={(e) => setStripes(e.target.value)}
            title={`Полоски (0–${maxStripes})`}
          />
        )}
        <input
          className={inputCls}
          placeholder="Заметка (необязательно)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          disabled={!level || selected.size === 0 || busy}
          onClick={() => void submit()}
        >
          {busy ? "…" : `Выдать выбранным (${selected.size})`}
        </Button>
      </div>

      {result && <p className="text-sm text-muted-foreground">{result}</p>}

      {roster === null ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          В клубе пока нет активных участников.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => selectWhere(() => true)}>
              Выбрать всех
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => selectWhere((e) => e.current === null)}
            >
              Всех без ранга
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Снять выбор
            </Button>
          </div>

          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {roster.map((entry) => (
              <li key={entry.userId}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.userId)}
                    onChange={() => toggle(entry.userId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {displayName(entry)}
                      {entry.isOwner && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          владелец
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.email}
                    </span>
                  </span>
                  {entry.current ? (
                    <RankChip
                      levelName={entry.current.levelName}
                      color={entry.current.color}
                      stripes={entry.current.stripes}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      без ранга
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
