"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getWorkspaceBilling,
  type WorkspaceBillingPage,
} from "../../../../../shared/api/billing"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import {
  billingBanner,
  formatBytes,
  formatDay,
  limitLabel,
  STATUS_LABEL,
  usagePercent,
} from "../../../../../features/billing/billing-view"

const UsageBar = ({
  label,
  used,
  max,
  format = (n: number) => String(n),
}: {
  label: string
  used: number
  max: number | null
  format?: (n: number) => string
}) => {
  const percent = usagePercent(used, max)
  const tone =
    percent === null || percent < 80
      ? "bg-primary"
      : percent < 100
        ? "bg-amber-500"
        : "bg-destructive"
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {format(used)} / {max === null ? "без ограничений" : format(max)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${percent ?? 4}%` }}
        />
      </div>
    </div>
  )
}

export default function WorkspaceBillingPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId ?? ""
  const [data, setData] = useState<WorkspaceBillingPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    setError(null)
    getWorkspaceBilling({ workspaceId })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errorMessage(e, "Не удалось загрузить тариф.")))
    return () => {
      alive = false
    }
  }, [workspaceId, attempt])

  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </Button>
      </div>
    )
  }
  if (!data) {
    return <div className="text-sm text-muted-foreground">Загрузка…</div>
  }

  if (!data.enabled) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Тариф и лимиты</h1>
        <p className="text-sm text-muted-foreground">
          На этой установке ClubSpace лимитов нет: участники, тренеры и видео — без
          ограничений.
        </p>
      </div>
    )
  }

  const { billing, plans } = data
  const banner = billingBanner(billing, new Date())
  const storageMax =
    billing.plan.maxStorageGb === null ? null : billing.plan.maxStorageGb * 1024 ** 3

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Тариф и лимиты</h1>
        <p className="text-sm text-muted-foreground">
          Тариф клуба в ClubSpace и сколько из него уже использовано.
        </p>
      </div>

      {banner && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            banner.tone === "danger"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {banner.text}
        </p>
      )}

      <section className="grid gap-6 rounded-lg border bg-card p-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Текущий тариф</div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold">{billing.plan.name}</span>
            <span className="rounded-full border px-2 py-0.5 text-xs">
              {STATUS_LABEL[billing.status]}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            {billing.plan.priceMonthly === 0
              ? "Бесплатно"
              : `${formatAmount(billing.plan.priceMonthly, billing.plan.currency)} в месяц`}
          </div>
          {billing.status === "TRIAL" && billing.trialEndsAt && (
            <div className="text-sm">
              Пробный период до {formatDay(billing.trialEndsAt)}
            </div>
          )}
          {billing.currentPeriodEnd && billing.status !== "TRIAL" && (
            <div className="text-sm">Оплачено до {formatDay(billing.currentPeriodEnd)}</div>
          )}
          {billing.suspendsAt && (
            <div className="text-sm text-destructive">
              Клуб будет приостановлен {formatDay(billing.suspendsAt)}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <UsageBar
            label="Участники"
            used={billing.usage.members}
            max={billing.plan.maxMembers}
          />
          <UsageBar
            label="Тренеры и администраторы"
            used={billing.usage.coaches}
            max={billing.plan.maxCoaches}
          />
          <UsageBar label="Видео" used={billing.usage.videos} max={billing.plan.maxVideos} />
          <UsageBar
            label="Место для видео"
            used={billing.usage.storageBytes}
            max={storageMax}
            format={formatBytes}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Тарифы</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => {
            const current = plan.planId === billing.plan.planId
            return (
              <div
                key={plan.planId}
                className={`space-y-3 rounded-lg border p-4 ${current ? "border-primary ring-1 ring-primary" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold">{plan.name}</span>
                  {current && (
                    <span className="text-xs text-primary">ваш тариф</span>
                  )}
                </div>
                <div className="text-sm">
                  {plan.priceMonthly === 0
                    ? "Бесплатно"
                    : `${formatAmount(plan.priceMonthly, plan.currency)} / мес`}
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>Участники: {limitLabel(plan.maxMembers)}</li>
                  <li>Тренеры: {limitLabel(plan.maxCoaches)}</li>
                  <li>Видео: {limitLabel(plan.maxVideos)}</li>
                  <li>Место для видео: {limitLabel(plan.maxStorageGb, " ГБ")}</li>
                </ul>
                <ul className="space-y-1 text-sm">
                  {plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Сменить тариф или продлить оплаченный период можно через команду ClubSpace:
          напишите нам — подключим нужный тариф и выставим счёт. После паузы из-за
          неоплаты всё содержимое клуба сохраняется.
        </p>
      </section>
    </div>
  )
}
