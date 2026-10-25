"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  addRankGradingCandidates,
  getRankReadiness,
  listRankGradings,
  type RankGradingSummary,
  type RankReadiness,
  type ReadinessEntry,
} from "../../shared/api/gradings"
import { listGroups, type GroupSummary } from "../../shared/api/groups"
import { errorMessage } from "../../shared/lib/error-message"
import { formatYmd } from "../../shared/lib/format-ymd"
import { inputCls } from "../../shared/lib/input-class"
import { RankChip } from "../ranks/RankChip"

const memberName = (e: ReadinessEntry) =>
  [e.firstname, e.lastname].filter(Boolean).join(" ") || e.email

const todayYmd = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Who is ready for the next belt: members with a rank on the ladder, measured
// against the next level's «допуск». Admins can put people on a grading list.
export function ReadinessPanel({
  workspaceId,
  isAdmin,
}: {
  workspaceId: string
  isAdmin: boolean
}) {
  const [data, setData] = useState<RankReadiness | null>(null)
  const [ladderId, setLadderId] = useState<string | undefined>()
  const [groupId, setGroupId] = useState("")
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [onlyReady, setOnlyReady] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [upcoming, setUpcoming] = useState<RankGradingSummary[]>([])
  const [gradingId, setGradingId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await getRankReadiness({
        workspaceId,
        ladderId,
        groupId: groupId || undefined,
      })
      setData(res)
      setSelected(new Set())
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить готовность к аттестации"))
    }
  }, [workspaceId, ladderId, groupId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      .catch(() => setGroups([]))
  }, [workspaceId])

  const activeLadderId = data?.ladderId ?? undefined
  const loadUpcoming = useCallback(async () => {
    if (!isAdmin || !activeLadderId) return
    try {
      const res = await listRankGradings({
        workspaceId,
        ladderId: activeLadderId,
      })
      const today = todayYmd()
      const rows = res.data.filter((g) => g.date >= today).reverse()
      setUpcoming(rows)
      setGradingId((prev) =>
        rows.some((g) => g.id === prev) ? prev : (rows[0]?.id ?? ""),
      )
    } catch {
      setUpcoming([])
    }
  }, [workspaceId, isAdmin, activeLadderId])

  useEffect(() => {
    void loadUpcoming()
  }, [loadUpcoming])

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })

  const addToGrading = async () => {
    if (!gradingId || selected.size === 0) return
    setBusy(true)
    setNotice(null)
    try {
      await addRankGradingCandidates({
        workspaceId,
        gradingId,
        data: { userIds: [...selected] },
      })
      setNotice(`Добавлено в аттестацию: ${selected.size}`)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось добавить в аттестацию"))
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <p className="text-sm text-muted-foreground">Загрузка…</p>
    )
  }

  if (data.ladders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        В клубе нет лестниц рангов — создайте их в разделе «Ранги».
      </p>
    )
  }

  const rows = data.data.filter((e) => !onlyReady || e.ready)
  const readyCount = data.data.filter((e) => e.ready).length

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {data.ladders.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLadderId(l.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              data.ladderId === l.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground hover:bg-muted/70"
            }`}
          >
            {l.name}
          </button>
        ))}
        <select
          className={`${inputCls} ml-auto`}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          aria-label="Группа"
        >
          <option value="">Все группы</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={onlyReady ? "default" : "outline"}
            onClick={() => setOnlyReady(true)}
          >
            Готовы · {readyCount}
          </Button>
          <Button
            size="sm"
            variant={onlyReady ? "outline" : "default"}
            onClick={() => setOnlyReady(false)}
          >
            Все
          </Button>
        </div>
      </div>

      {isAdmin && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/40 p-3 text-sm">
          {upcoming.length === 0 ? (
            <span className="text-muted-foreground">
              Сначала создайте аттестацию ниже
            </span>
          ) : (
            <>
              <select
                className={inputCls}
                value={gradingId}
                onChange={(e) => setGradingId(e.target.value)}
                aria-label="Аттестация"
              >
                {upcoming.map((g) => (
                  <option key={g.id} value={g.id}>
                    {formatYmd(g.date)} · {g.title}
                  </option>
                ))}
              </select>
              <Button disabled={busy} onClick={() => void addToGrading()}>
                Добавить в аттестацию ({selected.size})
              </Button>
            </>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {onlyReady
            ? "Сейчас никто не готов к аттестации."
            : "Нет участников с рангом на этой лестнице."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                {isAdmin && <th className="p-3" />}
                <th className="p-3">Участник</th>
                <th className="p-3">Сейчас → Следующий</th>
                <th className="p-3">Тренировок</th>
                <th className="p-3">Недель</th>
                <th className="p-3">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => (
                <tr key={e.userId}>
                  {isAdmin && (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label="Выбрать"
                        checked={selected.has(e.userId)}
                        disabled={e.pendingGrading !== null}
                        title={
                          e.pendingGrading
                            ? "Уже в списке аттестации"
                            : undefined
                        }
                        onChange={() => toggle(e.userId)}
                      />
                    </td>
                  )}
                  <td className="p-3">
                    <Link
                      href={`/workspace/${workspaceId}/users/${e.userId}`}
                      className="font-medium hover:underline"
                    >
                      {memberName(e)}
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <RankChip
                        levelName={e.current.levelName}
                        color={e.current.color}
                        stripes={e.current.stripes}
                      />
                      →
                      <RankChip
                        levelName={e.nextLevel.name}
                        color={e.nextLevel.color}
                        stripes={0}
                      />
                    </span>
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {e.visitsSince}
                    {e.rule?.minVisits != null ? ` / ${e.rule.minVisits}` : ""}
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {e.weeksSince}
                    {e.rule?.minWeeks != null ? ` / ${e.rule.minWeeks}` : ""}
                  </td>
                  <td className="p-3">
                    <span className="flex flex-wrap gap-1.5 text-xs">
                      {e.ready && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                          Готов
                        </span>
                      )}
                      {!e.ready && e.remainingText && (
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {e.remainingText}
                        </span>
                      )}
                      {!e.rule && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          Правило не задано
                        </span>
                      )}
                      {e.pendingGrading && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5">
                          В аттестации {formatYmd(e.pendingGrading.date)}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
