"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  getCohortRetention,
  type CohortRetention,
} from "../../../../../../shared/api/analytics"
import {
  COHORT_OFFSETS,
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  cohortCell,
  formatCohortMonth,
  formatPercent,
  rateCellClass,
} from "../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import {
  AnalyticsError,
  AnalyticsFilters,
  AnalyticsFreshness,
  AnalyticsSkeleton,
} from "../analytics-toolbar"

const PARTIAL_HINT = "когорта ещё не доросла"

export default function CohortsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [data, setData] = useState<CohortRetention | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setData(
        await getCohortRetention({ workspaceId, ...analyticsScope(filter) }),
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить удержание."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const cohorts = data?.cohorts ?? []
  const average = data?.average ?? []

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Удержание по когортам</h1>
        <p className="text-sm text-muted-foreground">
          Сколько учеников, пришедших в каждом месяце, продолжают ходить через
          1, 2, 3 и 6 месяцев.
        </p>
        <AnalyticsFreshness
          workspaceId={workspaceId}
          computedAt={data?.computedAt}
          onRefreshed={load}
        />
      </div>

      <AnalyticsFilters
        workspaceId={workspaceId}
        value={filter}
        onChange={setFilter}
      />

      <AnalyticsError message={error} />

      {loading ? (
        <AnalyticsSkeleton />
      ) : cohorts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Новых учеников за последние месяцы не было.
        </p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Средняя кривая удержания
            </div>
            <div className="flex h-32 gap-4">
              {COHORT_OFFSETS.map((offset) => {
                const point = average.find((a) => a.offset === offset)
                const rate = point?.rate ?? null
                return (
                  <div
                    key={offset}
                    className="flex flex-1 flex-col items-center gap-1"
                    title={
                      point
                        ? `Через ${offset} мес: ${formatPercent(rate)} (из ${point.eligible})`
                        : undefined
                    }
                  >
                    <span className="text-xs font-medium tabular-nums">
                      {formatPercent(rate)}
                    </span>
                    <div className="relative w-full flex-1">
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t bg-primary/80 transition-all"
                        style={{
                          height: `${Math.max(2, Math.round((rate ?? 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {offset} мес
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Месяц прихода</th>
                  <th className="p-3 text-right">Пришло</th>
                  {COHORT_OFFSETS.map((o) => (
                    <th key={o} className="p-3 text-center">
                      {o} мес
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cohorts.map((row) => (
                  <tr key={row.month}>
                    <td className="whitespace-nowrap p-3 font-medium">
                      {formatCohortMonth(row.month)}
                    </td>
                    <td className="p-3 text-right tabular-nums">{row.size}</td>
                    {COHORT_OFFSETS.map((o) => {
                      const cell = cohortCell(row, o)
                      const rate = cell?.rate ?? null
                      // A window that has only just opened reads 0% — not a
                      // cohort that left, just no visits counted yet.
                      const early = cell?.partial === true && rate === 0
                      return (
                        <td
                          key={o}
                          className={`p-3 text-center tabular-nums ${rateCellClass(early ? null : rate)} ${
                            cell?.partial ? "italic opacity-70" : ""
                          }`}
                          title={
                            cell?.partial
                              ? PARTIAL_HINT
                              : cell && rate !== null
                                ? `${cell.retained} из ${cell.eligible}`
                                : undefined
                          }
                        >
                          {early ? "рано" : formatPercent(rate)}
                          {cell?.partial && rate !== null && !early && "*"}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="bg-muted/50 font-medium">
                  <td className="p-3">Среднее</td>
                  <td className="p-3" />
                  {COHORT_OFFSETS.map((o) => {
                    const rate = average.find((a) => a.offset === o)?.rate ?? null
                    return (
                      <td key={o} className="p-3 text-center tabular-nums">
                        {formatPercent(rate)}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            * курсивом — {PARTIAL_HINT}: прошло меньше времени, чем нужно для
            этой колонки, цифра ещё изменится. «рано» — срок только наступил,
            посещений за него ещё нет.
          </p>
        </>
      )}
    </div>
  )
}
