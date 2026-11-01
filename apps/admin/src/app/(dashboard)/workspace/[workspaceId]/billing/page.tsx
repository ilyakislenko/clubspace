"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getWorkspaceBilling,
  type BillingModule,
  type WorkspaceBillingPage,
} from "../../../../../shared/api/billing"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import {
  BANNER_TONE_CLASS,
  billingBanner,
  formatBytes,
  formatDay,
  formatHours,
  moduleStateLabel,
  STATUS_LABEL,
  tierRows,
  usagePercent,
  type Banner,
} from "../../../../../features/billing/billing-view"
import { BillingModuleAction } from "../../../../../features/billing/BillingModuleAction"
import { BillingPaymentSection } from "../../../../../features/billing/BillingPaymentSection"
import { BillingPaymentsHistory } from "../../../../../features/billing/BillingPaymentsHistory"
import { QuoteSummary } from "../../../../../features/billing/QuoteSummary"
import { usePaymentReturn } from "../../../../../features/billing/use-payment-return"

const Meter = ({
  label,
  usedLabel,
  percent,
}: {
  label: string
  usedLabel: string
  percent: number
}) => {
  const tone =
    percent < 80 ? "bg-primary" : percent < 100 ? "bg-amber-500" : "bg-destructive"
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{usedLabel}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  )
}

const MODULE_BADGE_CLASS: Record<BillingModule["source"], string> = {
  TRIAL: "border-sky-300 bg-sky-50 text-sky-900",
  PAID: "border-emerald-300 bg-emerald-50 text-emerald-900",
  SELF_HOSTED: "border-emerald-300 bg-emerald-50 text-emerald-900",
  COMP: "border-emerald-300 bg-emerald-50 text-emerald-900",
  OFF: "border-border bg-muted text-muted-foreground",
  NONE: "border-border bg-muted text-muted-foreground",
}

export default function WorkspaceBillingPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId ?? ""
  const [data, setData] = useState<WorkspaceBillingPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The outcome of the last payment / module / card action, shown on top.
  const [notice, setNotice] = useState<Banner | null>(null)
  const paymentReturn = usePaymentReturn(workspaceId)

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

  // Back from YooKassa: show how the payment went, reload billing and history.
  useEffect(() => {
    if (!paymentReturn.result) return
    setNotice(paymentReturn.result)
    setAttempt((n) => n + 1)
  }, [paymentReturn.result])

  const reloadWith = (next: Banner) => {
    setNotice(next)
    setAttempt((n) => n + 1)
  }

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
        <h1 className="text-2xl font-semibold">Тариф</h1>
        <p className="text-sm text-muted-foreground">
          На этой установке ClubSpace оплата не взимается: все разделы и модули
          доступны без ограничений.
        </p>
      </div>
    )
  }

  const { billing, tiers, annualDiscountPercent, graceDays } = data
  const { quote, videoUsage } = billing
  const currency = quote.currency
  const banner = billingBanner(billing, new Date())
  const rows = tierRows(tiers, currency)
  const video = billing.modules.find((m) => m.code === "VIDEO")
  const includedStorageBytes = videoUsage.includedStorageGb * 1024 ** 3
  const includedViewSeconds = videoUsage.includedViewHours * 3600
  const freeUntilActive =
    billing.freeUntil !== null && new Date(billing.freeUntil) > new Date()

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Тариф</h1>
        <p className="text-sm text-muted-foreground">
          Сколько клуб платит ClubSpace: тариф по числу активных учеников и
          подключённые модули.
        </p>
      </div>

      {paymentReturn.checking && (
        <p className={`rounded-md border px-3 py-2 text-sm ${BANNER_TONE_CLASS.info}`}>
          Проверяем платёж…
        </p>
      )}

      {notice && (
        <p className={`rounded-md border px-3 py-2 text-sm ${BANNER_TONE_CLASS[notice.tone]}`}>
          {notice.text}
        </p>
      )}

      {banner && (
        <p className={`rounded-md border px-3 py-2 text-sm ${BANNER_TONE_CLASS[banner.tone]}`}>
          {banner.text}
        </p>
      )}

      <section className="grid gap-6 rounded-lg border bg-card p-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Статус</div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold">{billing.tier.name}</span>
            <span className="rounded-full border px-2 py-0.5 text-xs">
              {STATUS_LABEL[billing.status]}
            </span>
          </div>
          {billing.status === "TRIAL" && billing.trialEndsAt && (
            <div className="text-sm">
              Пробный период до {formatDay(billing.trialEndsAt)} — все модули
              включены
            </div>
          )}
          {billing.currentPeriodEnd && billing.status !== "TRIAL" && (
            <div className="text-sm">Оплачено до {formatDay(billing.currentPeriodEnd)}</div>
          )}
          {freeUntilActive && billing.freeUntil && (
            <div className="text-sm text-emerald-700">
              Бесплатно до {formatDay(billing.freeUntil)}
            </div>
          )}
          {billing.suspendsAt && (
            <div className="text-sm text-destructive">
              Клуб будет приостановлен {formatDay(billing.suspendsAt)}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Активные ученики</div>
          <div className="text-sm">
            Активных учеников: <span className="font-semibold">{billing.activeMembers}</span>{" "}
            — тариф «{billing.tier.name}»
            {billing.tier.upTo !== null ? ` (до ${billing.tier.upTo})` : ""}
          </div>
          {billing.tier.upTo !== null && (
            <Meter
              label="Заполнение тарифа"
              usedLabel={`${billing.activeMembers} из ${billing.tier.upTo}`}
              percent={usagePercent(billing.activeMembers, billing.tier.upTo)}
            />
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Активный — ученик (в том числе ребёнок), который за последние 30 дней
            был на тренировке или открывал клуб в приложении. Тренеры и
            администраторы не считаются. Тариф подбирается сам по числу активных
            — ничего не блокируется.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Тарифы</h2>
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => {
            const current = row.code === billing.tier.code
            return (
              <li
                key={row.code}
                className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm ${
                  current ? "bg-primary/5" : ""
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className={current ? "font-semibold" : "font-medium"}>
                    {row.name}
                  </span>
                  <span className="text-muted-foreground">{row.range} активных</span>
                  {current && <span className="text-xs text-primary">ваш тариф</span>}
                </span>
                <span className={current ? "font-semibold" : ""}>{row.price}</span>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Все разделы приложения, кроме платных модулей ниже, входят в любой
          тариф.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Модули</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {billing.modules.map((m) => (
            <div key={m.code} className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{m.name}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${MODULE_BADGE_CLASS[m.source]}`}
                >
                  {moduleStateLabel(m)}
                </span>
              </div>
              <div className="text-sm">{formatAmount(m.priceMonthly, currency)} / мес</div>
              {m.includes.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {m.includes.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
              )}
              <BillingModuleAction
                workspaceId={workspaceId}
                module={m}
                currency={currency}
                cardLast4={billing.autopay.card?.last4 ?? null}
                currentPeriodEnd={billing.currentPeriodEnd}
                onDone={reloadWith}
              />
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {billing.status === "TRIAL"
            ? "В пробный период все модули включены. Модули, которые не подключены, после его окончания отключатся. "
            : ""}
          Подключённый модуль оплачивается вместе с тарифом; при подключении посреди
          оплаченного периода списывается его остаток. Отключённый модуль работает до
          конца оплаченного периода.
        </p>
      </section>

      {video?.entitled && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Видео: использование</h2>
          <Meter
            label="Хранилище"
            usedLabel={`${formatBytes(videoUsage.storageBytes)} из ${videoUsage.includedStorageGb} ГБ`}
            percent={usagePercent(videoUsage.storageBytes, includedStorageBytes)}
          />
          <Meter
            label="Просмотры в этом месяце"
            usedLabel={`${formatHours(videoUsage.viewedSecondsThisMonth)} ч из ${videoUsage.includedViewHours} ч`}
            percent={usagePercent(videoUsage.viewedSecondsThisMonth, includedViewSeconds)}
          />
          <p className="text-xs text-muted-foreground">
            Сверх лимита оплачивается в следующем счёте.
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Следующий счёт</h2>
        <QuoteSummary quote={quote} nextChargeAt={billing.nextChargeAt} />
        {quote.periodMonths !== 12 && annualDiscountPercent > 0 && (
          <p className="text-xs text-muted-foreground">
            При оплате за год — скидка {annualDiscountPercent}%.
          </p>
        )}
      </section>

      <BillingPaymentSection
        workspaceId={workspaceId}
        billing={billing}
        annualDiscountPercent={annualDiscountPercent}
        onChanged={reloadWith}
      />

      <BillingPaymentsHistory workspaceId={workspaceId} reloadKey={attempt} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Если продление не оплачено вовремя, клуб ещё {graceDays}{" "}
        {pluralRu(graceDays, "день", "дня", "дней")} работает в режиме «Ожидает оплаты»,
        затем приостанавливается. После паузы всё содержимое клуба сохраняется.
      </p>
    </div>
  )
}
