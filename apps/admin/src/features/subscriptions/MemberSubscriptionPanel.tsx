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
  type MemberAbonement,
  type MemberSubscriptions,
  type Plan,
  type Subscription,
} from "../../shared/api/subscriptions"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { pluralRu } from "../../shared/lib/plural-ru"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { DirectionScopeChips } from "../directions/DirectionScopePicker"
import {
  ABONEMENT_STATE_LABEL,
  abonementState,
  isLiveState,
} from "./abonement-state"
import { FreezeHistory } from "./FreezeHistory"
import {
  addDaysYmd,
  formatDay,
  openFreezeOf,
  todayYmd,
} from "./freeze-utils"
import { MarkPaidForm } from "./MarkPaidForm"
import {
  lastPaymentMethod,
  rememberPaymentMethod,
  type ClubPaymentMethod,
} from "./payment-method"
import { PaymentMethodPicker } from "./PaymentMethodPicker"
import {
  classesLabel,
  formatAmount,
  isPending,
  paymentEntryHref,
  paymentLabel,
  periodLabel,
  renewFromForPlan,
} from "./subscription-display"
import { SubscriptionFreezeBlock } from "./SubscriptionFreezeBlock"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { isClubAdmin } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { agree, countForm, fromFirstSession } from "@clubspace/ui-kit/brand"

const SALE_AMOUNT = FORM_LIMITS.payment.saleAmount

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("ru-RU") : "—"

// Self-contained abonement panel for a member profile. Lists every current
// abonement (a member may hold several with different direction scopes) +
// history and lets staff assign a tariff (which extends the
// member's "Доступ до"). What each button may do comes from the server's
// `permissions`: a coach manages members of their own groups, only an admin
// cancels, and undoing a payment stays admin-only (`canUnmarkPayment`). Refetches its
// own data so the parent page needn't know about subscriptions.
export function MemberSubscriptionPanel({
  workspaceId,
  userId,
  isAdmin,
  canCreatePlans,
  onAssigned,
}: {
  workspaceId: string
  userId: string
  isAdmin: boolean
  // Tariffs are the club admins' (the «Тарифы» page is theirs only).
  canCreatePlans: boolean
  // Notified after an assignment so the parent can refresh accessUntil.
  onAssigned?: () => void
}) {
  const vocabulary = useVocabulary()
  // Club admins open a paid abonement's payment in «Абонементы → Платежи».
  const seesJournal = isClubAdmin(useMyMembership(workspaceId))
  const [plans, setPlans] = useState<Plan[]>([])
  const [subs, setSubs] = useState<MemberSubscriptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState("")
  const [startDate, setStartDate] = useState("")
  // What the sale is recorded at: the plan price unless changed (a discount).
  const [amountText, setAmountText] = useState("")
  const [paid, setPaid] = useState(true)
  // How a sale recorded as paid was paid; set from the last pick on choosing
  // a tariff (read in the browser only).
  const [paymentMethod, setPaymentMethod] = useState<ClubPaymentMethod>("CASH")
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

  const amount = parseIntInput(amountText, SALE_AMOUNT)

  const choosePlan = (id: string) => {
    setPlanId(id)
    const plan = plans.find((p) => p.id === id)
    setAmountText(plan ? String(plan.price) : "")
    setPaymentMethod(lastPaymentMethod())
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
          ...(paid ? { paymentMethod } : {}),
        },
      })
      if (paid) rememberPaymentMethod(paymentMethod)
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
    const ok = await confirmDialog({
      title: "Отменить абонемент?",
      description: hasOpenFreeze
        ? "Абонемент перестанет действовать сразу, вернуть его нельзя. Заморозка тоже будет снята."
        : "Абонемент перестанет действовать сразу, вернуть его нельзя.",
      confirmLabel: "Отменить абонемент",
      cancelLabel: "Не отменять",
      destructive: true,
    })
    if (!ok) return
    try {
      await cancelSubscription({ workspaceId, userId, subscriptionId })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить абонемент"))
    }
  }

  const markPaid = async (
    subscriptionId: string,
    received: number,
    method: ClubPaymentMethod,
  ) => {
    setPayBusy(true)
    try {
      await markSubscriptionPaid({
        workspaceId,
        userId,
        subscriptionId,
        data: { amount: received, method },
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
    const ok = await confirmDialog({
      title: "Отменить отметку оплаты?",
      description:
        "Абонемент снова будет «Ожидает оплаты», а ученик попадёт в должники.",
      confirmLabel: "Отменить отметку",
      cancelLabel: "Не отменять",
    })
    if (!ok) return
    try {
      await unmarkSubscriptionPaid({ workspaceId, userId, subscriptionId })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить отметку оплаты"))
    }
  }

  const abonements = subs?.abonements ?? []
  const currentIds = new Set(abonements.map((a) => a.id))
  const selectedPlan = plans.find((p) => p.id === planId)

  const afterFreezeChange = async () => {
    await load()
    onAssigned?.()
  }

  const now = new Date()
  const today = todayYmd(now)
  const canManage = subs?.permissions.canManage ?? false
  const canCancel = subs?.permissions.canCancel ?? false
  const canUnmarkPayment = subs?.permissions.canUnmarkPayment ?? false
  const openFreezeOfAbonement = (id: string) =>
    subs ? openFreezeOf(subs.freezes, id, today) : null
  const stateOf = (s: Subscription) =>
    abonementState(s, subs?.freezes ?? [], now)
  // A coach's sale date is capped by the same-scope abonement it renews.
  const renewFrom = selectedPlan
    ? renewFromForPlan(selectedPlan, abonements)
    : null

  // «Продлить»: prefill the sale with this abonement's tariff and the day it
  // can be continued from.
  const renew = (a: MemberAbonement) => {
    choosePlan(a.planId)
    setStartDate(a.renewFrom && a.renewFrom > today ? a.renewFrom : "")
  }

  const renderAbonement = (a: MemberAbonement) => {
    const freeze = openFreezeOfAbonement(a.id)
    const classes = classesLabel(a)
    const state = stateOf(a)
    const stateLine =
      state === "frozen" && freeze
        ? `Заморожен по ${formatDay(freeze.untilDate)}`
        : state === "upcoming" && isPending(a)
          ? `Начнётся ${fromFirstSession(vocabulary)}`
          : state === "upcoming"
            ? `Начнётся ${fmtDate(a.startDate)} · до ${fmtDate(a.endDate)}`
            : a.endDate
              ? `${ABONEMENT_STATE_LABEL[state]} · до ${fmtDate(a.endDate)}`
              : ABONEMENT_STATE_LABEL[state]
    return (
      <li key={a.id} className="space-y-2 px-3 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{a.planName}</span>
          <DirectionScopeChips directions={a.directions} />
          <span className="text-muted-foreground">
            {stateLine}
            {classes ? ` · ${classes}` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {a.isPaid && seesJournal ? (
            <Link href={paymentEntryHref(workspaceId, a.id)} className="hover:underline">
              {paymentLabel(a)}
            </Link>
          ) : (
            <span className={a.isPaid ? "" : "text-amber-700"}>
              {paymentLabel(a)}
            </span>
          )}
          {/* One payment form at a time: the others wait until it is closed. */}
          {canManage && !a.isPaid && payingId === null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPayingId(a.id)}
            >
              Отметить оплату
            </Button>
          )}
          {canUnmarkPayment && a.isPaid && a.status !== "CANCELLED" && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => void unmarkPaid(a.id)}
            >
              Отменить отметку оплаты
            </button>
          )}
          {canManage && plans.some((p) => p.id === a.planId) && (
            <Button variant="outline" size="sm" onClick={() => renew(a)}>
              Продлить
            </Button>
          )}
          {canCancel && isLiveState(state) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void cancel(a.id)}
            >
              Отменить
            </Button>
          )}
        </div>

        {canManage && payingId === a.id && (
          <MarkPaidForm
            key={a.id}
            amount={a.amountPaid}
            currency={a.currency}
            busy={payBusy}
            onSubmit={(received, method) => void markPaid(a.id, received, method)}
            onCancel={() => setPayingId(null)}
          />
        )}

        {isPending(a) && (
          <p className="text-xs text-muted-foreground">
            Заморозка станет доступна после {agree(vocabulary.session, "первой", "первого")} {vocabulary.session.gen}
          </p>
        )}

        {subs && canManage && a.endDate && (
          <SubscriptionFreezeBlock
            workspaceId={workspaceId}
            userId={userId}
            current={a}
            freezes={subs.freezes}
            onChanged={afterFreezeChange}
          />
        )}
      </li>
    )
  }

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium">
        {abonements.length > 1 ? "Абонементы" : "Абонемент"}
      </h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {abonements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Нет действующего абонемента
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {abonements.map(renderAbonement)}
        </ul>
      )}

      {subs && canManage && plans.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {canCreatePlans ? (
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
          {/* Shrinks below its longest option so «Назначить» stays on the row. */}
          <select
            className={`${inputCls} min-w-0 flex-1 basis-60`}
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
                {p.classCount != null
                  ? ` · ${p.classCount} ${countForm(p.classCount, vocabulary.session, pluralRu)}`
                  : " · безлимит"}
                {p.isFreeTrial ? " · пробный, один раз" : ""}
                {p.startsOnFirstVisit ? ` · с 1-${agree(vocabulary.session, "й", "го")} ${vocabulary.session.gen}` : ""}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            type="date"
            value={startDate}
            // A coach's date is bounded like the server's check (3 days back,
            // up to the end of the same-scope abonement); admins pick any date.
            min={isAdmin ? undefined : addDaysYmd(today, -3)}
            max={
              isAdmin
                ? undefined
                : renewFrom && renewFrom > today
                  ? renewFrom
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
          {paid && (
            <PaymentMethodPicker
              value={paymentMethod}
              onChange={setPaymentMethod}
              disabled={busy}
            />
          )}
          <Button
            disabled={!planId || amount === null || busy}
            onClick={() => void assign()}
          >
            {busy ? "…" : "Назначить"}
          </Button>
          {planId && amount === null && (
            <p className="basis-full text-xs text-destructive">
              Введите сумму от {SALE_AMOUNT.min} до {SALE_AMOUNT.max.toLocaleString("ru-RU")}
            </p>
          )}
          {selectedPlan?.startsOnFirstVisit && (
            <p className="basis-full text-xs text-muted-foreground">
              Без даты — начнётся {fromFirstSession(vocabulary)}. Укажите дату, если
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
                {s.planName} · {periodLabel(s, vocabulary)} ·{" "}
                <span className="text-muted-foreground">
                  {ABONEMENT_STATE_LABEL[stateOf(s)]}
                </span>
                {!s.isPaid && s.status !== "CANCELLED" && (
                  <span className="text-amber-700"> · ожидает оплаты</span>
                )}
              </span>
              <span className="flex shrink-0 gap-2">
                {canManage &&
                  !s.isPaid &&
                  s.status !== "CANCELLED" &&
                  !currentIds.has(s.id) &&
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
                  !currentIds.has(s.id) && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                      onClick={() => void unmarkPaid(s.id)}
                    >
                      Отменить отметку оплаты
                    </button>
                  )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {subs &&
        canManage &&
        payingId &&
        !currentIds.has(payingId) &&
        (() => {
          const row = subs.history.find((h) => h.id === payingId)
          return row ? (
            <MarkPaidForm
              key={row.id}
              amount={row.amountPaid}
              currency={row.currency}
              busy={payBusy}
              onSubmit={(received, method) => void markPaid(row.id, received, method)}
              onCancel={() => setPayingId(null)}
            />
          ) : null
        })()}

      {subs && <FreezeHistory freezes={subs.freezes} history={subs.history} />}
    </section>
  )
}
