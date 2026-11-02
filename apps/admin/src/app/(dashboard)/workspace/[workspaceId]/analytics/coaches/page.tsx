"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  getCoachAnalytics,
  type CoachAnalytics,
} from "../../../../../../shared/api/analytics"
import {
  EMPTY_ANALYTICS_FILTER,
  MIN_COACH_SAMPLE,
  analyticsScope,
  bestRetentionCoachId,
  formatAverage,
  formatPercent,
  personName,
} from "../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import {
  AnalyticsError,
  AnalyticsFilters,
  AnalyticsFreshness,
  AnalyticsSkeleton,
} from "../analytics-toolbar"

export default function CoachesAnalyticsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [data, setData] = useState<CoachAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setData(
        await getCoachAnalytics({ workspaceId, ...analyticsScope(filter) }),
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить статистику тренеров."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const coaches = data?.coaches ?? []
  const bestId = bestRetentionCoachId(coaches)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Тренеры</h1>
        <p className="text-sm text-muted-foreground">
          Сколько учеников ходит к каждому тренеру, сколько остаётся через 3
          месяца и как продлевают абонементы.
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
      ) : coaches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Нет тренеров с группами.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Тренер</th>
                  <th className="p-3 text-right">Активные ученики</th>
                  <th className="p-3 text-right">Удержание 3 мес</th>
                  <th className="p-3 text-right">Продления</th>
                  <th className="p-3 text-right">На занятии в среднем</th>
                  <th className="p-3 text-right">Занятий</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {coaches.map((c) => {
                  const best = c.coachId === bestId
                  return (
                    <tr key={c.coachId} className={best ? "bg-primary/5" : ""}>
                      <td className="p-3 font-medium">
                        {personName(c)}
                        {best && (
                          <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            лучшее удержание
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 text-right tabular-nums">
                        {c.activeStudents}
                      </td>
                      <td className="whitespace-nowrap p-3 text-right tabular-nums">
                        {formatPercent(c.retention.rate)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({c.retention.retained} из {c.retention.eligible})
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-3 text-right tabular-nums">
                        {formatPercent(c.renewals.rate)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({c.renewals.done} из {c.renewals.due})
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-3 text-right tabular-nums">
                        {formatAverage(c.avgAttendance)}
                      </td>
                      <td className="whitespace-nowrap p-3 text-right tabular-nums">
                        {c.classes}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Активные — были на занятии за последние 30 дней. Удержание — доля
            учеников, начавших больше 3 месяцев назад, которые ходят и сейчас.
            Занятия и посещаемость — за {data?.weeks ?? 8} недель. «Лучшее
            удержание» отмечаем, когда учеников для оценки не меньше{" "}
            {MIN_COACH_SAMPLE}.
          </p>
        </>
      )}
    </div>
  )
}
