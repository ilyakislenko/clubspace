"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"

import { cap, fromFirstSession } from "@clubspace/ui-kit/brand"
import { Button } from "@clubspace/ui-kit/ui"

import { DirectionScopeChips } from "../../../../../../../features/directions/DirectionScopePicker"
import {
  classesLabel,
  formatAmount,
  periodLabel,
} from "../../../../../../../features/subscriptions/subscription-display"
import {
  getPlan,
  type PlanDetails,
} from "../../../../../../../shared/api/subscriptions"
import { personName } from "../../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../../../../../shared/lib/vocabulary"

// The tariff page (behind the section's AdminOrDirectionManagerGate; the
// server opens it on the same terms as editing the tariff).
export default function WorkspacePlanPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string; planId: string }>()
  const workspaceId = params?.workspaceId
  const planId = params?.planId

  const [details, setDetails] = useState<PlanDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !planId) return
    void getPlan({ workspaceId, planId })
      .then((d) => {
        setDetails(d)
        setError(null)
      })
      .catch((err) => setError(errorMessage(err, "Не удалось загрузить тариф")))
      .finally(() => setLoading(false))
  }, [workspaceId, planId])

  const backLink = (
    <Link
      href={`/workspace/${workspaceId}/subscriptions`}
      className="text-xs text-muted-foreground hover:underline"
    >
      ← Тарифы и абонементы
    </Link>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    )
  }

  if (error || !details) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? "Тариф не найден"}
        </p>
      </div>
    )
  }

  const { plan, holders, last30Days } = details
  const facts: Array<[string, ReactNode]> = [
    ["Цена", plan.price === 0 ? "Бесплатно" : formatAmount(plan.price, plan.currency)],
    [
      "Занятий",
      plan.classCount != null
        ? `${plan.classCount} ${pluralRu(plan.classCount, "занятие", "занятия", "занятий")}`
        : "Без ограничения",
    ],
    ["Срок", `${plan.durationDays} дн.`],
    [
      "Начало срока",
      plan.startsOnFirstVisit
        ? cap(fromFirstSession(vocabulary))
        : "Со дня продажи",
    ],
    [
      "Направления",
      plan.directions.length > 0 ? (
        <DirectionScopeChips directions={plan.directions} />
      ) : (
        "Весь клуб"
      ),
    ],
    ["Онлайн-продажа", plan.purchasableOnline ? "Да, в приложении" : "Нет"],
  ]

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{plan.name}</h1>
            {plan.isFreeTrial && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                Пробное
              </span>
            )}
            {!plan.isActive && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                В архиве
              </span>
            )}
          </div>
          <Button asChild size="sm">
            <Link href={`/workspace/${workspaceId}/subscriptions?edit=${plan.id}`}>
              Редактировать
            </Link>
          </Button>
        </div>
        {plan.description && (
          <p className="text-sm text-muted-foreground">{plan.description}</p>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-center gap-x-2">
            <dt className="text-muted-foreground">{label}:</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Действующих абонементов" value={String(holders.length)} />
        <Stat label="Продано за 30 дней" value={String(last30Days.sold)} />
        <Stat
          label="Выручка за 30 дней"
          value={formatAmount(last30Days.revenue, plan.currency)}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">У кого действует</h2>
        {holders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Сейчас ни у кого нет действующего абонемента по этому тарифу.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Ученик</th>
                  <th className="p-3">Срок</th>
                  <th className="p-3">Занятия</th>
                  <th className="p-3">Оплата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {holders.map((h) => (
                  <tr key={h.subscriptionId}>
                    <td className="p-3">
                      <Link
                        href={`/workspace/${workspaceId}/users/${h.userId}`}
                        className="font-medium hover:underline"
                      >
                        {personName(h)}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">{periodLabel(h)}</td>
                    <td className="p-3 tabular-nums text-muted-foreground">
                      {classesLabel(h) ?? "—"}
                    </td>
                    <td className="p-3">
                      {h.isPaid ? (
                        <span className="text-muted-foreground">Оплачен</span>
                      ) : (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700">
                          Ожидает оплаты
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
