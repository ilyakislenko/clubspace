"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getMemberRanks,
  listRankLadders,
  promoteMember,
  type MemberRanks,
  type RankLadder,
} from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { RankChip } from "./RankChip"

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString("ru-RU")

// Self-contained rank panel for a member profile: current rank per ladder +
// a promote form (ladder → level → stripes) + promotion history.
export function MemberRankPanel({
  workspaceId,
  userId,
}: {
  workspaceId: string
  userId: string
}) {
  const [ladders, setLadders] = useState<RankLadder[]>([])
  const [ranks, setRanks] = useState<MemberRanks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ladderId, setLadderId] = useState("")
  const [levelId, setLevelId] = useState("")
  const [stripes, setStripes] = useState("0")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [ladderRes, rankRes] = await Promise.all([
        listRankLadders({ workspaceId }),
        getMemberRanks({ workspaceId, userId }),
      ])
      setLadders(ladderRes.data)
      setRanks(rankRes)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить ранги"))
    } finally {
      setLoaded(true)
    }
  }, [workspaceId, userId])

  useEffect(() => {
    void load()
  }, [load])

  const levels = useMemo(
    () =>
      ladders
        .find((l) => l.id === ladderId)
        ?.levels.filter((lv) => lv.isActive) ?? [],
    [ladders, ladderId],
  )

  const promote = async () => {
    if (!ladderId || !levelId) return
    setBusy(true)
    try {
      await promoteMember({
        workspaceId,
        userId,
        data: {
          ladderId,
          levelId,
          stripes: Number(stripes) || 0,
          note: note.trim() || undefined,
        },
      })
      setLevelId("")
      setStripes("0")
      setNote("")
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось выдать ранг"))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  if (ladders.length === 0) {
    // Say where ladders come from instead of hiding the panel: a missing panel
    // read as "ranks can't be given to this member".
    return (
      <section className="space-y-1 rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium">Ранг</h2>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            В клубе нет активных лестниц рангов.{" "}
            <Link
              href={`/workspace/${workspaceId}/ranks`}
              className="underline hover:text-foreground"
            >
              Создайте лестницу
            </Link>
            , чтобы присваивать ранги.
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium">Ранг</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {ranks && ranks.current.length > 0 ? (
          ranks.current.map((c) => (
            <span key={c.ladderId} className="text-sm">
              <span className="text-muted-foreground">{c.ladderName}: </span>
              <RankChip levelName={c.levelName} color={c.color} stripes={c.stripes} />
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">Ранг не присвоен</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputCls}
          value={ladderId}
          onChange={(e) => {
            setLadderId(e.target.value)
            setLevelId("")
          }}
        >
          <option value="">Лестница…</option>
          {ladders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={levelId}
          onChange={(e) => setLevelId(e.target.value)}
          disabled={!ladderId}
        >
          <option value="">Уровень…</option>
          {levels.map((lv) => (
            <option key={lv.id} value={lv.id}>
              {lv.name}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-20`}
          type="number"
          min={0}
          value={stripes}
          onChange={(e) => setStripes(e.target.value)}
          title="Полоски"
        />
        <input
          className={inputCls}
          placeholder="Заметка (необязательно)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button disabled={!ladderId || !levelId || busy} onClick={() => void promote()}>
          {busy ? "…" : "Выдать"}
        </Button>
      </div>

      {ranks && ranks.history.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {ranks.history.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="text-muted-foreground">{p.ladderName}: </span>
                <RankChip levelName={p.levelName} color={p.color} stripes={p.stripes} />
                {p.note ? ` — ${p.note}` : ""}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {fmtDate(p.awardedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
