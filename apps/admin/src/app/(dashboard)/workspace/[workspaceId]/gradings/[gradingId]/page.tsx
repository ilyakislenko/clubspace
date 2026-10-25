"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { RankChip } from "../../../../../../features/ranks/RankChip"
import {
  deleteRankGrading,
  getRankGrading,
  recordRankGradingResults,
  removeRankGradingCandidate,
  updateRankGrading,
  updateRankGradingCandidate,
  type RankGradingCandidate,
  type RankGradingDetail,
  type RankGradingResult,
} from "../../../../../../shared/api/gradings"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import { formatAmount } from "../../../../../../features/subscriptions/subscription-display"
import { formatYmd } from "../../../../../../shared/lib/format-ymd"
import { inputCls } from "../../../../../../shared/lib/input-class"
import { parseIntInput } from "../../../../../../shared/lib/parse-int-input"

const candidateName = (c: RankGradingCandidate) =>
  [c.firstname, c.lastname].filter(Boolean).join(" ") || c.email

const RESULT_OPTIONS: { value: RankGradingResult; label: string }[] = [
  { value: "PENDING", label: "—" },
  { value: "PASSED", label: "Сдал" },
  { value: "FAILED", label: "Не сдал" },
]

export default function GradingDetailPage() {
  const params = useParams<{ workspaceId: string; gradingId: string }>()
  const router = useRouter()
  const workspaceId = params?.workspaceId
  const gradingId = params?.gradingId

  const [grading, setGrading] = useState<RankGradingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [fee, setFee] = useState("")

  const load = useCallback(async () => {
    if (!workspaceId || !gradingId) return
    try {
      setGrading(await getRankGrading({ workspaceId, gradingId }))
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить аттестацию"))
    }
  }, [workspaceId, gradingId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setNotice(null)
    // Cleared here, not in load(): the reload after a failed action must not
    // wipe the very error that explains why nothing changed.
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errorMessage(e, fallback))
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!workspaceId || !gradingId) return null
  if (!grading) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <p className="text-sm text-muted-foreground">Загрузка…</p>
    )
  }

  const pending = grading.candidates.filter((c) => c.result === "PENDING")

  const startEdit = () => {
    setTitle(grading.title)
    setDate(grading.date)
    setFee(grading.feeAmount != null ? String(grading.feeAmount) : "")
    setEditing(true)
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    let feeAmount: number | null = null
    if (fee.trim()) {
      const parsed = parseIntInput(fee, { min: 0, max: 10_000_000 })
      if (parsed === null) {
        setError("Взнос: целое число")
        return
      }
      feeAmount = parsed
    }
    await run(async () => {
      await updateRankGrading({
        workspaceId,
        gradingId,
        data: { title: title.trim() || undefined, date, feeAmount },
      })
      setEditing(false)
    }, "Не удалось сохранить аттестацию")
  }

  const remove = async () => {
    if (!window.confirm("Удалить аттестацию?")) return
    setBusy(true)
    setError(null)
    try {
      await deleteRankGrading({ workspaceId, gradingId })
      router.push(`/workspace/${workspaceId}/gradings`)
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить аттестацию"))
      setBusy(false)
    }
  }

  const setResult = (c: RankGradingCandidate, result: RankGradingResult) => {
    if (result === c.result) return
    if (
      result === "PASSED" &&
      !window.confirm(
        `Присвоить ранг «${c.levelName}»: ${candidateName(c)}? Отменить будет нельзя.`,
      )
    )
      return
    void run(async () => {
      const res = await recordRankGradingResults({
        workspaceId,
        gradingId,
        data: { results: [{ candidateId: c.id, result }] },
      })
      if (res.promoted > 0) setNotice(`Присвоено рангов: ${res.promoted}`)
    }, "Не удалось записать результат")
  }

  const passAll = () => {
    if (
      !window.confirm(
        `Присвоить ранг ${pending.length} кандидатам? Отменить будет нельзя.`,
      )
    )
      return
    void run(async () => {
      const res = await recordRankGradingResults({
        workspaceId,
        gradingId,
        data: {
          results: pending.map((c) => ({
            candidateId: c.id,
            result: "PASSED" as const,
          })),
        },
      })
      setNotice(`Присвоено рангов: ${res.promoted}`)
    }, "Не удалось записать результаты")
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/workspace/${workspaceId}/gradings`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Аттестации
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{grading.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatYmd(grading.date)} · {grading.ladderName}
          {grading.gym ? ` · ${grading.gym.name}` : ""}
          {grading.feeAmount != null
            ? ` · взнос ${formatAmount(grading.feeAmount, grading.feeCurrency ?? "RUB")}`
            : ""}
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={startEdit}>
            Изменить
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            Удалить
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      {editing && (
        <form
          onSubmit={(e) => void saveEdit(e)}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/40 p-4"
        >
          <input
            className={inputCls}
            type="date"
            aria-label="Дата"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className={inputCls}
            aria-label="Название"
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className={`${inputCls} w-28`}
            placeholder="Взнос"
            aria-label="Взнос"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <Button type="submit" disabled={busy || !date}>
            Сохранить
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(false)}
          >
            Отмена
          </Button>
        </form>
      )}

      {pending.length > 0 && (
        <Button disabled={busy} onClick={passAll}>
          Все оставшиеся сдали ({pending.length})
        </Button>
      )}

      {grading.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Кандидатов пока нет — добавьте их на вкладке «Аттестации», в списке
          «Готовы».
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Участник</th>
                <th className="p-3">Было → Станет</th>
                <th className="p-3">Результат</th>
                <th className="p-3">Взнос</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grading.candidates.map((c) => (
                <tr key={c.id}>
                  <td className="p-3">
                    <Link
                      href={`/workspace/${workspaceId}/users/${c.userId}`}
                      className="font-medium hover:underline"
                    >
                      {candidateName(c)}
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {c.fromLevelName ? (
                        <span className="text-xs">
                          {c.fromLevelName}
                          {c.fromStripes ? ` · ${c.fromStripes}★` : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          без ранга
                        </span>
                      )}
                      →
                      <RankChip
                        levelName={c.levelName}
                        color={c.levelColor}
                        stripes={c.stripes}
                      />
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="inline-flex overflow-hidden rounded-md border border-border">
                      {RESULT_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          disabled={busy || (c.result === "PASSED" && o.value !== "PASSED")}
                          onClick={() => setResult(c, o.value)}
                          className={`px-3 py-1 text-xs disabled:opacity-40 ${
                            c.result === o.value
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={c.paid}
                        disabled={busy}
                        onChange={(e) =>
                          void run(
                            () =>
                              updateRankGradingCandidate({
                                workspaceId,
                                gradingId,
                                candidateId: c.id,
                                data: { paid: e.target.checked },
                              }),
                            "Не удалось отметить оплату",
                          )
                        }
                      />
                      оплачен
                    </label>
                  </td>
                  <td className="p-3">
                    {c.result !== "PASSED" && (
                      <button
                        className="text-xs text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Убрать ${candidateName(c)} из аттестации?`,
                            )
                          )
                            return
                          void run(
                            () =>
                              removeRankGradingCandidate({
                                workspaceId,
                                gradingId,
                                candidateId: c.id,
                              }),
                            "Не удалось убрать кандидата",
                          )
                        }}
                      >
                        Убрать
                      </button>
                    )}
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
