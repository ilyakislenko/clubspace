"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  assignSubscription,
  cancelSubscription,
  listMemberSubscriptions,
  listPlans,
  type MemberSubscriptions,
  type Plan,
} from "../../shared/api/subscriptions"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { FreezeHistory } from "./FreezeHistory"
import { formatDay, freezePhase, openFreezeOf, todayYmd } from "./freeze-utils"
import { isPending, periodLabel } from "./subscription-display"
import { SubscriptionFreezeBlock } from "./SubscriptionFreezeBlock"

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Активен",
  SUSPENDED: "Приостановлен",
  CANCELLED: "Отменён",
  EXPIRED: "Истёк",
}

const statusLabel = (status: string): string => STATUS_LABEL[status] ?? status

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("ru-RU") : "—"

// Self-contained abonement panel for a member profile. Lists the current
// abonement + history and lets an admin assign a tariff (which extends the
// member's "Доступ до"). Refetches its own data so the parent page needn't know
// about subscriptions.
export function MemberSubscriptionPanel({
  workspaceId,
  userId,
  onAssigned,
}: {
  workspaceId: string
  userId: string
  // Notified after an assignment so the parent can refresh accessUntil.
  onAssigned?: () => void
}) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [subs, setSubs] = useState<MemberSubscriptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [planRes, subRes] = await Promise.all([
        listPlans({ workspaceId }),
        listMemberSubscriptions({ workspaceId, userId }),
      ])
      setPlans(planRes.data)
      setSubs(subRes)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить абонементы"))
    }
  }, [workspaceId, userId])

  useEffect(() => {
    void load()
  }, [load])

  const assign = async () => {
    if (!planId) return
    setBusy(true)
    try {
      await assignSubscription({
        workspaceId,
        userId,
        data: { planId, startDate: startDate || undefined },
      })
      setPlanId("")
      setStartDate("")
      await load()
      onAssigned?.()
    } catch (e) {
      setError(errorMessage(e, "Не удалось назначить абонемент"))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (subscriptionId: string) => {
    const hasOpenFreeze = subs
      ? openFreezeOf(subs.freezes, subscriptionId, todayYmd(new Date())) !==
        null
      : false
    const message = hasOpenFreeze
      ? "Отменить этот абонемент? Заморозка тоже будет снята."
      : "Отменить этот абонемент?"
    if (!window.confirm(message)) return
    try {
      await cancelSubscription({ workspaceId, userId, subscriptionId })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить абонемент"))
    }
  }

  const current = subs?.current ?? null
  const selectedPlan = plans.find((p) => p.id === planId)

  const afterFreezeChange = async () => {
    await load()
    onAssigned?.()
  }

  const today = todayYmd(new Date())
  const currentFreeze =
    subs && current ? openFreezeOf(subs.freezes, current.id, today) : null
  const frozenNow =
    currentFreeze !== null && freezePhase(currentFreeze, today) === "current"

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium">Абонемент</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="text-sm">
        {current ? (
          <span>
            Текущий: <span className="font-medium">{current.planName}</span> ·
            статус{" "}
            {frozenNow && currentFreeze
              ? `Заморожен по ${formatDay(currentFreeze.untilDate)}`
              : statusLabel(current.status)}{" "}
            {isPending(current)
              ? "· начнётся с первой тренировки"
              : `· до ${fmtDate(current.endDate)}`}
          </span>
        ) : (
          <span className="text-muted-foreground">Нет действующего абонемента</span>
        )}
      </div>

      {subs && current && isPending(current) && (
        <p className="text-xs text-muted-foreground">
          Заморозка станет доступна после первой тренировки
        </p>
      )}

      {subs && current?.endDate && (
        <SubscriptionFreezeBlock
          workspaceId={workspaceId}
          userId={userId}
          current={current}
          freezes={subs.freezes}
          onChanged={afterFreezeChange}
        />
      )}

      {subs && plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          В клубе нет тарифов.{" "}
          <Link
            href={`/workspace/${workspaceId}/subscriptions`}
            className="underline hover:text-foreground"
          >
            Создайте тариф
          </Link>
          , чтобы назначать абонементы.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputCls}
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">Выберите тариф…</option>
            {plans.map((p) => (
              // The class count and the one-time-trial flag both belong here: a
              // trial can only ever be granted once per member, and without the
              // hint the second attempt fails with no visible reason.
              <option key={p.id} value={p.id}>
                {p.name} — {p.price} {p.currency} · {p.durationDays} дн.
                {p.classCount != null ? ` · ${p.classCount} занятий` : " · безлимит"}
                {p.isFreeTrial ? " · пробный, один раз" : ""}
                {p.startsOnFirstVisit ? " · с 1-й тренировки" : ""}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Button disabled={!planId || busy} onClick={() => void assign()}>
            {busy ? "…" : "Назначить"}
          </Button>
          {selectedPlan?.startsOnFirstVisit && (
            <p className="basis-full text-xs text-muted-foreground">
              Без даты — начнётся с первой тренировки. Укажите дату, если
              абонемент уже идёт
            </p>
          )}
        </div>
      )}

      {subs && subs.history.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {subs.history.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0">
                {s.planName} · {periodLabel(s)} ·{" "}
                <span className="text-muted-foreground">
                  {frozenNow && s.id === current?.id
                    ? "Заморожен"
                    : statusLabel(s.status)}
                </span>
              </span>
              {s.status === "ACTIVE" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancel(s.id)}
                >
                  Отменить
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {subs && <FreezeHistory freezes={subs.freezes} history={subs.history} />}
    </section>
  )
}
