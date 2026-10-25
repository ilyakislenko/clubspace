"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createRankGrading,
  listRankGradings,
  type RankGradingSummary,
} from "../../shared/api/gradings"
import { listGyms, type Gym } from "../../shared/api/groups"
import { listRankLadders, type RankLadder } from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { formatYmd } from "../../shared/lib/format-ymd"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"

// Admin-only: schedule a grading and open past/upcoming ones.
export function GradingsPanel({ workspaceId }: { workspaceId: string }) {
  const [gradings, setGradings] = useState<RankGradingSummary[] | null>(null)
  const [ladders, setLadders] = useState<RankLadder[]>([])
  const [gyms, setGyms] = useState<Gym[]>([])
  const [date, setDate] = useState("")
  const [ladderId, setLadderId] = useState("")
  const [title, setTitle] = useState("")
  const [gymId, setGymId] = useState("")
  const [fee, setFee] = useState("")
  const [currency, setCurrency] = useState("RUB")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGradings((await listRankGradings({ workspaceId })).data)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить аттестации"))
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void listRankLadders({ workspaceId })
      .then((res) => {
        setLadders(res.data)
        setLadderId((prev) => prev || (res.data[0]?.id ?? ""))
      })
      .catch(() => setLadders([]))
    void listGyms({ workspaceId })
      .then((res) => setGyms(res.data))
      .catch(() => setGyms([]))
  }, [workspaceId])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!date || !ladderId) return
    let feeAmount: number | undefined
    if (fee.trim()) {
      const parsed = parseIntInput(fee, { min: 0, max: 10_000_000 })
      if (parsed === null) {
        setError("Взнос: целое число")
        return
      }
      feeAmount = parsed
    }
    setBusy(true)
    setError(null)
    try {
      await createRankGrading({
        workspaceId,
        data: {
          ladderId,
          date,
          title: title.trim() || undefined,
          gymId: gymId || undefined,
          feeAmount,
          feeCurrency: feeAmount !== undefined ? currency.trim() : undefined,
        },
      })
      setTitle("")
      setFee("")
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось создать аттестацию"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Аттестации</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <form
        onSubmit={submit}
        className="space-y-2 rounded-xl border border-border bg-card/40 p-4"
      >
        <p className="text-sm font-medium">Новая аттестация</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={inputCls}
            type="date"
            aria-label="Дата"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <select
            className={inputCls}
            aria-label="Лестница"
            value={ladderId}
            onChange={(e) => setLadderId(e.target.value)}
          >
            {ladders
              .filter((l) => l.isActive)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          <input
            className={inputCls}
            placeholder="Название (необязательно)"
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select
            className={inputCls}
            aria-label="Зал"
            value={gymId}
            onChange={(e) => setGymId(e.target.value)}
          >
            <option value="">Зал не указан</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input
            className={`${inputCls} w-28`}
            placeholder="Взнос"
            aria-label="Взнос"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <input
            className={`${inputCls} w-20`}
            placeholder="Валюта"
            aria-label="Валюта"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
          <Button type="submit" disabled={busy || !date || !ladderId}>
            Создать
          </Button>
        </div>
      </form>

      {gradings === null ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : gradings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Аттестаций пока нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {gradings.map((g) => (
            <li key={g.id}>
              <Link
                href={`/workspace/${workspaceId}/gradings/${g.id}`}
                className="block px-3 py-2 hover:bg-muted/50"
              >
                <span className="font-medium">{formatYmd(g.date)}</span> ·{" "}
                {g.ladderName} · {g.counts.candidates} кандидатов · сдали{" "}
                {g.counts.passed} · оплатили {g.counts.paid}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
