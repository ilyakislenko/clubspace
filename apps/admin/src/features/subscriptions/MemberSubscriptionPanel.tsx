"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  assignSubscription,
  cancelSubscription,
  listMemberSubscriptions,
  listPlans,
  markSubscriptionPaid,
  unmarkSubscriptionPaid,
  type MemberSubscriptions,
  type Plan,
} from "../../shared/api/subscriptions"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { FreezeHistory } from "./FreezeHistory"
import {
  addDaysYmd,
  formatDay,
  freezePhase,
  openFreezeOf,
  todayYmd,
} from "./freeze-utils"
import { MarkPaidForm, MAX_PAYMENT } from "./MarkPaidForm"
import {
  formatAmount,
  isPending,
  paymentLabel,
  periodLabel,
} from "./subscription-display"
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
// abonement + history and lets staff assign a tariff (which extends the
// member's "Доступ до"). What each button may do comes from the server's
// `permissions`: a coach manages members of their own groups, only an admin
// cancels, and undoing a payment stays admin-only (`canUnmarkPayment`). Refetches its
// own data so the parent page needn't know about subscriptions.
export function MemberSubscriptionPanel({
  workspaceId,
  userId,
  isAdmin,
  onAssigned,
}: {
  workspaceId: string
  userId: string
  isAdmin: boolean
  // Notified after an assignment so the parent can refresh accessUntil.
  onAssigned?: () => void
}) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [subs, setSubs] = useState<MemberSubscriptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState("")
  const [startDate, setStartDate] = useState("")
  // What the sale is recorded at: the plan price unless changed (a discount).
  const [amountText, setAmountText] = useState("")
  const [paid, setPaid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payBusy, setPayBusy] = useState(false)

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

  const amount = parseIntInput(amountText, { min: 0, max: MAX_PAYMENT })

  const choosePlan = (id: string) => {
    setPlanId(id)
    const plan = plans.find((p) => p.id === id)
    setAmountText(plan ? String(plan.price) : "")
  }

  const assign = async () => {
    if (!planId || amount === null) return
    setBusy(true)
    try {
      await assignSubscription({
        workspaceId,
        userId,
        data: {
          planId,
          startDate: startDate || undefined,
          amountPaid: amount,
          paid,
        },
      })
      setPlanId("")
      setStartDate("")
      setAmountText("")
      setPaid(true)
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

  const markPaid = async (subscriptionId: string, received: number) => {
    setPayBusy(true)
    try {
      await markSubscriptionPaid({
        workspaceId,
        userId,
        subscriptionId,
        data: { amount: received },
      })
      setPayingId(null)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отметить оплату"))
    } finally {
      setPayBusy(false)
    }
  }

  const unmarkPaid = async (subscriptionId: string) => {
    if (
      !window.confirm(
        "Отменить отметку оплаты? Абонемент снова будет «Ожидает оплаты».",
      )
    )
      return
    try {
      await unmarkSubscriptionPaid({ workspaceId, userId, subscriptionId })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить отметку оплаты"))
    }
  }

  const current = subs?.current ?? null
  const selectedPlan = plans.find((p) => p.id === planId)

  const afterFreezeChange = async () => {
    await load()
    onAssigned?.()
  }

  const today = todayYmd(new Date())
  const canManage = subs?.permissions.canManage ?? false
  const canCancel = subs?.permissions.canCancel ?? false
  const canUnmarkPayment = subs?.permissions.canUnmarkPayment ?? false
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

      {current && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={current.isPaid ? "" : "text-amber-700"}>
            {paymentLabel(current)}
          </span>
          {/* One payment form at a time: the others wait until it is closed. */}
          {canManage && !current.isPaid && payingId === null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPayingId(current.id)}
            >
              Отметить оплату
            </Button>
          )}
          {canUnmarkPayment && current.isPaid && current.status !== "CANCELLED" && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => void unmarkPaid(current.id)}
            >
              Отменить отметку оплаты
            </button>
          )}
        </div>
      )}

      {canManage && current && payingId === current.id && (
        <MarkPaidForm
          key={current.id}
          amount={current.amountPaid}
          currency={current.currency}
          busy={payBusy}
          onSubmit={(received) => void markPaid(current.id, received)}
          onCancel={() => setPayingId(null)}
        />
      )}

      {subs && current && isPending(current) && (
        <p className="text-xs text-muted-foreground">
          Заморозка станет доступна после первой тренировки
        </p>
      )}

      {subs && canManage && current?.endDate && (
        <SubscriptionFreezeBlock
          workspaceId={workspaceId}
          userId={userId}
          current={current}
          freezes={subs.freezes}
          freezeRequest={subs.freezeRequest}
          onChanged={afterFreezeChange}
        />
      )}

      {subs && canManage && plans.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isAdmin ? (
            <>
              В клубе нет тарифов.{" "}
              <Link
                href={`/workspace/${workspaceId}/subscriptions`}
                className="underline hover:text-foreground"
              >
                Создайте тариф
              </Link>
              , чтобы назначать абонементы.
            </>
          ) : (
            "В клубе нет тарифов — попросите администратора создать тариф"
          )}
        </p>
      )}

      {canManage && plans.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputCls}
            value={planId}
            onChange={(e) => choosePlan(e.target.value)}
          >
            <option value="">Выберите тариф…</option>
            {plans.map((p) => (
              // The class count and the one-time-trial flag both belong here: a
              // trial can only ever be granted once per member, and without the
              // hint the second attempt fails with no visible reason.
              <option key={p.id} value={p.id}>
                {p.name} — {formatAmount(p.price, p.currency)} · {p.durationDays} дн.
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
            // A coach's date is bounded like the server's check (3 days back,
            // up to the end of the current abonement); admins pick any date.
            min={isAdmin ? undefined : addDaysYmd(today, -3)}
            max={
              isAdmin
                ? undefined
                : subs?.renewFrom && subs.renewFrom > today
                  ? subs.renewFrom
                  : today
            }
            onChange={(e) => setStartDate(e.target.value)}
          />
          <input
            className={`${inputCls} w-28`}
            inputMode="numeric"
            aria-label="Сумма"
            placeholder="Сумма"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
            />
            Оплата получена
          </label>
          <Button
            disabled={!planId || amount === null || busy}
            onClick={() => void assign()}
          >
            {busy ? "…" : "Назначить"}
          </Button>
          {planId && amount === null && (
            <p className="basis-full text-xs text-destructive">
              Введите сумму от 0 до 10 000 000
            </p>
          )}
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
                {!s.isPaid && s.status !== "CANCELLED" && (
                  <span className="text-amber-700"> · ожидает оплаты</span>
                )}
              </span>
              <span className="flex shrink-0 gap-2">
                {canManage &&
                  !s.isPaid &&
                  s.status !== "CANCELLED" &&
                  s.id !== current?.id &&
                  payingId === null && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPayingId(s.id)}
                    >
                      Отметить оплату
                    </Button>
                  )}
                {canUnmarkPayment &&
                  s.isPaid &&
                  s.status !== "CANCELLED" &&
                  s.id !== current?.id && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                      onClick={() => void unmarkPaid(s.id)}
                    >
                      Отменить отметку оплаты
                    </button>
                  )}
                {canCancel && s.status === "ACTIVE" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void cancel(s.id)}
                  >
                    Отменить
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {subs &&
        canManage &&
        payingId &&
        payingId !== current?.id &&
        (() => {
          const row = subs.history.find((h) => h.id === payingId)
          return row ? (
            <MarkPaidForm
              key={row.id}
              amount={row.amountPaid}
              currency={row.currency}
              busy={payBusy}
              onSubmit={(received) => void markPaid(row.id, received)}
              onCancel={() => setPayingId(null)}
            />
          ) : null
        })()}

      {subs && <FreezeHistory freezes={subs.freezes} history={subs.history} />}
    </section>
  )
}
