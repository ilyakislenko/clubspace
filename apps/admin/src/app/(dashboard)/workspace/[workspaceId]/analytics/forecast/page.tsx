"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  getRevenueForecast,
  type RevenueForecast,
} from "../../../../../../shared/api/analytics"
import {
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  formatPercent,
} from "../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../../shared/lib/plural-ru"
import {
  AnalyticsCard,
  AnalyticsError,
  AnalyticsFilters,
  AnalyticsFreshness,
  AnalyticsSkeleton,
  formatMoney,
} from "../analytics-toolbar"

export default function ForecastPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [data, setData] = useState<RevenueForecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setData(
        await getRevenueForecast({ workspaceId, ...analyticsScope(filter) }),
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить прогноз."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const money = (n: number) => formatMoney(n, data?.currency ?? null)
  const renewal = data?.renewal
  const trial = data?.trial

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Прогноз выручки</h1>
        <p className="text-sm text-muted-foreground">
          Сколько принесут продления текущих абонементов, если ученики будут
          продлевать так же, как раньше, с поправкой на риск ухода.
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
      ) : !data || !renewal || !trial ? null : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.horizons.map((h) => (
              <section
                key={h.days}
                className="space-y-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="text-xs uppercase text-muted-foreground">
                  Следующие {h.days} {pluralRu(h.days, "день", "дня", "дней")}
                </div>
                <div className="whitespace-nowrap text-3xl font-semibold tabular-nums">
                  {money(h.expected)}
                </div>
                <div className="text-xs text-muted-foreground">
                  ожидаемо от продлений
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">Если все продлят</dt>
                  <dd className="text-right tabular-nums">
                    {money(h.potential)}
                  </dd>
                  <dt className="text-muted-foreground">Риск потери</dt>
                  <dd className="text-right tabular-nums text-destructive">
                    {money(h.atRisk)}
                  </dd>
                </dl>
                {h.potential > 0 && (
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary/80"
                      style={{
                        width: `${Math.round((h.expected / h.potential) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </section>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnalyticsCard
              label="Продлевают вовремя"
              value={formatPercent(renewal.scopeRate ?? renewal.clubRate)}
              subtitle={
                renewal.usesDefault
                  ? `мало истории — берём ${formatPercent(renewal.clubRate)}`
                  : renewal.scopeRate !== null
                    ? `${renewalSample(renewal.scopeSample)} · по клубу ${formatPercent(renewal.clubRate)}`
                    : `по клубу, ${renewalSample(renewal.clubSample)}`
              }
            />
            <AnalyticsCard
              label="Средние траты в месяц"
              value={money(data.monthlyRecurring)}
              subtitle={`${data.members} ${pluralRu(data.members, "ученик", "ученика", "учеников")} сейчас, в среднем за полгода (продажи месяца — в «Обзоре»)`}
            />
            <AnalyticsCard
              label="На кону у учеников с высоким риском"
              value={money(data.highRiskMoney)}
              subtitle={
                <Link
                  href={`/workspace/${workspaceId}/analytics/churn`}
                  className="text-primary hover:underline"
                >
                  Кому позвонить →
                </Link>
              }
              tone={data.highRiskMoney > 0 ? "warn" : "default"}
            />
            <AnalyticsCard
              label="Пробные → оплата"
              value={formatPercent(trial.rate)}
              subtitle={
                trial.trials === 0
                  ? "пробных занятий не было"
                  : `${trial.converted} из ${trial.trials}${
                      trial.medianDaysToPay !== null
                        ? ` · платят в среднем через ${trial.medianDaysToPay} ${pluralRu(trial.medianDaysToPay, "день", "дня", "дней")}`
                        : ""
                    }`
              }
            />
          </div>
        </>
      )}
    </div>
  )
}

// What the renewal share is taken over: abonements, not people — the ones
// that ended 14–180 days ago, of members who have left too.
const renewalSample = (n: number) =>
  `из ${n} ${pluralRu(n, "абонемента", "абонементов", "абонементов")}, закончившихся 14–180 дней назад, включая ушедших`
