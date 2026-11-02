"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformWorkspaceBilling,
  listPlatformWorkspacePayments,
  refundPlatformWorkspacePayment,
  retryPlatformWorkspacePayment,
  setPlatformWorkspaceAutopay,
  updatePlatformWorkspaceBilling,
  updatePlatformWorkspaceModule,
  type PlatformWorkspace,
  type PlatformWorkspaceBillingCard,
  type PlatformWorkspacePayment,
  type UpdatePlatformWorkspaceBillingBody,
  type UpdatePlatformWorkspaceModuleBody,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  BANNER_TONE_CLASS,
  formatDay,
  moduleStateLabel,
  parseRefundAmount,
  refundableAmount,
  retryOutcomeBanner,
  STATUS_LABEL,
  type Banner,
} from "../billing/billing-view"
import { PaymentsTable } from "../billing/PaymentsTable"
import { QuoteSummary } from "../billing/QuoteSummary"
import { PlatformAppSections } from "./PlatformAppSections"
import { PlatformLegalAcceptances } from "./PlatformLegalAcceptances"
import { PlatformPromoPresets } from "./PlatformPromoPresets"
import { PlatformTrialCost } from "./PlatformTrialCost"
import {
  auditActionLabel,
  describeAudit,
  fmtAuditWhen,
  MODULE_MODE_LABEL,
} from "./PlatformAuditFeed"

const STATUS_CLASS: Record<string, string> = {
  TRIAL: "border-sky-300 bg-sky-50 text-sky-900",
  ACTIVE: "border-emerald-300 bg-emerald-50 text-emerald-900",
  PAST_DUE: "border-amber-300 bg-amber-50 text-amber-900",
  SUSPENDED: "border-destructive/40 bg-destructive/10 text-destructive",
}

type ModuleCode = UpdatePlatformWorkspaceModuleBody["module"]
type ModuleModeChoice = UpdatePlatformWorkspaceModuleBody["mode"]
type ModuleDraft = { mode: ModuleModeChoice; compUntil: string; customPrice: string }
// The refund form under the payments list: `amount` empty = the whole `max`.
type RefundDraft = {
  paymentId: string
  max: number
  currency: string
  amount: string
  reason: string
}

const MODE_CHOICES: ModuleModeChoice[] = ["DEFAULT", "PAID", "COMP", "OFF"]

// Whole number in [min, max] or null.
const parseIntIn = (raw: string, min: number, max: number): number | null => {
  const n = Number(raw.trim())
  return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null
}

// The card's dates are ISO instants; <input type="date"> wants YYYY-MM-DD.
const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "")

const moduleDrafts = (card: PlatformWorkspaceBillingCard): Record<string, ModuleDraft> =>
  Object.fromEntries(
    card.billing.modules.map((m) => [
      m.code,
      {
        // `mode` is null when no override row exists: that is «По умолчанию».
        mode: m.mode ?? "DEFAULT",
        compUntil: toDateInput(m.compUntil),
        customPrice: m.customPrice === null ? "" : String(m.customPrice),
      },
    ]),
  )

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="space-y-1">
    <span className="block text-xs text-muted-foreground">{label}</span>
    {children}
  </label>
)

// A club's billing in the console: one summary line in the clubs list, and on
// demand the full card — what the club pays, modules, app sections, every
// operator override, card payments and autopay, and the console's history for
// the club. «Отметить оплату» records an invoice paid outside the card checkout.
export function PlatformWorkspaceBilling({
  workspace,
  onChanged,
}: {
  workspace: PlatformWorkspace
  onChanged: (notice: string) => Promise<void> | void
}) {
  const { billing } = workspace
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState<PlatformWorkspaceBillingCard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [days, setDays] = useState("30")
  const [notes, setNotes] = useState("")
  const [customPrice, setCustomPrice] = useState("")
  const [discount, setDiscount] = useState("0")
  const [discountUntil, setDiscountUntil] = useState("")
  const [freeUntil, setFreeUntil] = useState("")
  const [modules, setModules] = useState<Record<string, ModuleDraft>>({})
  const [payments, setPayments] = useState<PlatformWorkspacePayment[] | null>(null)
  const [paymentNotice, setPaymentNotice] = useState<Banner | null>(null)
  const [refund, setRefund] = useState<RefundDraft | null>(null)

  const applyCard = (next: PlatformWorkspaceBillingCard) => {
    setCard(next)
    setNotes(next.notes ?? "")
    setCustomPrice(
      next.overrides.customMonthlyPrice === null
        ? ""
        : String(next.overrides.customMonthlyPrice),
    )
    setDiscount(String(next.overrides.discountPercent))
    setDiscountUntil(toDateInput(next.overrides.discountUntil))
    setFreeUntil(toDateInput(next.overrides.freeUntil))
    setModules(moduleDrafts(next))
  }

  // Card payments are their own list, reloaded after every payment action.
  const loadPayments = async () => {
    try {
      setPayments((await listPlatformWorkspacePayments(workspace.workspaceId)).data)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить платежи клуба."))
    }
  }

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || card) return
    setBusy(true)
    setError(null)
    try {
      applyCard(await fetchPlatformWorkspaceBilling(workspace.workspaceId))
      await loadPayments()
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить тариф клуба."))
    } finally {
      setBusy(false)
    }
  }

  // «Повторить списание сейчас»: the due renewal from the saved card, now.
  const retryCharge = async () => {
    if (!window.confirm(`Списать оплату с сохранённой карты клуба «${workspace.name}» сейчас?`)) {
      return
    }
    setBusy(true)
    setError(null)
    setPaymentNotice(null)
    try {
      const r = await retryPlatformWorkspacePayment(workspace.workspaceId)
      const outcome = retryOutcomeBanner(r.outcome, r.reason)
      setPaymentNotice(outcome)
      applyCard(await fetchPlatformWorkspaceBilling(workspace.workspaceId))
      await loadPayments()
      await onChanged(`«${workspace.name}»: ${outcome.text}`)
    } catch (e) {
      setError(errorMessage(e, "Не удалось повторить списание."))
    } finally {
      setBusy(false)
    }
  }

  const startRefund = (p: PlatformWorkspacePayment) => {
    setPaymentNotice(null)
    setRefund({
      paymentId: p.id,
      max: refundableAmount(p),
      currency: p.currency,
      amount: "",
      reason: "",
    })
  }

  const submitRefund = async () => {
    if (!refund) return
    const amount = parseRefundAmount(refund.amount, refund.max)
    if (amount === null) return
    const sum = formatAmount(amount === "full" ? refund.max : amount, refund.currency)
    if (!window.confirm(`Вернуть клубу «${workspace.name}» ${sum} на карту?`)) return
    setBusy(true)
    setError(null)
    try {
      const reason = refund.reason.trim()
      await refundPlatformWorkspacePayment(workspace.workspaceId, refund.paymentId, {
        ...(amount === "full" ? {} : { amount }),
        ...(reason ? { reason } : {}),
      })
      setRefund(null)
      setPaymentNotice({ tone: "success", text: `Возврат ${sum} оформлен.` })
      applyCard(await fetchPlatformWorkspaceBilling(workspace.workspaceId))
      await loadPayments()
    } catch (e) {
      setError(errorMessage(e, "Не удалось оформить возврат."))
    } finally {
      setBusy(false)
    }
  }

  // Every write answers with the refreshed card; the list row is reloaded too
  // so its summary line follows.
  const run = async (call: () => Promise<PlatformWorkspaceBillingCard>, done: string) => {
    setBusy(true)
    setError(null)
    try {
      applyCard(await call())
      await onChanged(`«${workspace.name}»: ${done}.`)
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить."))
    } finally {
      setBusy(false)
    }
  }

  const act = (body: UpdatePlatformWorkspaceBillingBody, done: string) =>
    run(() => updatePlatformWorkspaceBilling(workspace.workspaceId, body), done)

  const setModule = (code: ModuleCode, name: string) => {
    const draft = modules[code]
    if (!draft) return
    const body: UpdatePlatformWorkspaceModuleBody = { module: code, mode: draft.mode }
    if (draft.mode === "COMP") body.compUntil = draft.compUntil
    if (draft.mode === "PAID") {
      body.customPrice = draft.customPrice.trim() === "" ? null : Number(draft.customPrice)
    }
    return run(
      () => updatePlatformWorkspaceModule(workspace.workspaceId, body),
      `модуль «${name}» — ${MODULE_MODE_LABEL[draft.mode].toLowerCase()}`,
    )
  }

  const dayCount = parseIntIn(days, 1, 366)
  const priceValue = parseIntIn(customPrice, 0, 10_000_000)
  const discountValue = parseIntIn(discount, 0, 100)

  const view = card?.billing
  const currency = view?.quote.currency ?? "RUB"

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 ${STATUS_CLASS[billing.status]}`}>
          {STATUS_LABEL[billing.status]}
        </span>
        <span className="font-medium">
          {billing.tier.name}
          {billing.tier.upTo !== null ? ` (до ${billing.tier.upTo})` : ""}
        </span>
        <span className="text-muted-foreground">активных {billing.activeMembers}</span>
        {billing.status === "TRIAL" && billing.trialEndsAt && (
          <span className="text-muted-foreground">
            пробный до {formatDay(billing.trialEndsAt)}
          </span>
        )}
        {billing.status !== "TRIAL" && billing.currentPeriodEnd && (
          <span className="text-muted-foreground">
            оплачено до {formatDay(billing.currentPeriodEnd)}
          </span>
        )}
        {workspace.promos.map((p) => (
          <span key={`${p.kind}:${p.title}`} className="text-emerald-700">
            {p.title.toLowerCase()}
            {p.until ? ` до ${formatDay(p.until)}` : ""}
          </span>
        ))}
        {billing.suspendsAt && (
          <span className="text-destructive">пауза {formatDay(billing.suspendsAt)}</span>
        )}
        {billing.archivedAt && (
          <span className="text-destructive">в архиве с {formatDay(billing.archivedAt)}</span>
        )}
        {workspace.billingNotes && (
          <span className="max-w-xs truncate text-muted-foreground">
            · {workspace.billingNotes}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={toggle}>
          {open ? "Скрыть" : "Тариф"}
        </Button>
      </div>

      {open && (
        <div className="space-y-4 rounded-md bg-muted/50 p-3">
          {!card && busy && <p className="text-xs text-muted-foreground">Загрузка…</p>}

          {card && view && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Состояние</div>
                  <div>
                    Активных учеников: <span className="font-semibold">{view.activeMembers}</span>{" "}
                    — тариф «{view.tier.name}»
                    {view.tier.upTo !== null ? ` (до ${view.tier.upTo})` : ""}
                  </div>
                  {view.paidTier && (
                    <div className="text-xs text-muted-foreground">
                      Последняя оплата — по тарифу «{view.paidTier.name}»
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {STATUS_LABEL[view.status]}
                    {view.trialEndsAt ? ` · пробный до ${formatDay(view.trialEndsAt)}` : ""}
                    {view.currentPeriodEnd
                      ? ` · оплачено до ${formatDay(view.currentPeriodEnd)}`
                      : ""}
                    {view.pastDueSince ? ` · просрочка с ${formatDay(view.pastDueSince)}` : ""}
                    {view.suspendsAt ? ` · пауза ${formatDay(view.suspendsAt)}` : ""}
                  </div>
                  {view.promos.length > 0 && (
                    <ul className="text-xs text-emerald-700">
                      {view.promos.map((p) => (
                        <li key={`${p.kind}:${p.title}`}>
                          {p.title}
                          {p.until ? ` — до ${formatDay(p.until)}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Подключение {formatAmount(view.setupFee.amount, currency)}:{" "}
                    {view.setupFee.waived
                      ? "не берётся"
                      : view.setupFee.paidAt
                        ? `оплачено ${formatDay(view.setupFee.paidAt)}`
                        : "ещё не оплачено"}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Следующий счёт
                  </div>
                  <QuoteSummary quote={view.quote} nextChargeAt={view.nextChargeAt} />
                </div>
              </div>

              <PlatformTrialCost card={card} busy={busy} act={act} />

              <PlatformLegalAcceptances card={card} />

              <section className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Оплата и период</div>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Дней">
                    <input
                      className={`${inputClsFull} w-24`}
                      inputMode="numeric"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || dayCount === null}
                    onClick={() =>
                      dayCount !== null &&
                      act({ kind: "markPaid", days: dayCount }, `оплата на ${dayCount} дн. отмечена`)
                    }
                  >
                    Отметить оплату
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || dayCount === null}
                    onClick={() =>
                      dayCount !== null &&
                      act(
                        { kind: "extendPeriod", days: dayCount },
                        `оплаченный период продлён на ${dayCount} дн.`,
                      )
                    }
                  >
                    Продлить период
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || dayCount === null}
                    onClick={() =>
                      dayCount !== null &&
                      act(
                        { kind: "extendTrial", days: dayCount },
                        `пробный период продлён на ${dayCount} дн.`,
                      )
                    }
                  >
                    Продлить пробный период
                  </Button>
                  {view.status === "SUSPENDED" ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => act({ kind: "resume" }, "клуб снова работает")}
                    >
                      Возобновить
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => act({ kind: "suspend" }, "клуб приостановлен")}
                    >
                      Приостановить
                    </Button>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Оплата картой и автосписание
                </div>
                {!view.autopay.available ? (
                  <p className="text-xs text-muted-foreground">
                    Платёжный магазин ClubSpace не настроен — оплата картой недоступна.
                  </p>
                ) : (
                  <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span>
                        {view.autopay.card
                          ? `${view.autopay.card.title ?? "Карта"}${view.autopay.card.last4 ? ` •••• ${view.autopay.card.last4}` : ""}${view.autopay.card.savedAt ? ` · сохранена ${formatDay(view.autopay.card.savedAt)}` : ""}`
                          : "Карта не сохранена"}
                      </span>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={view.autopay.enabled}
                          disabled={busy}
                          onChange={(e) =>
                            void run(
                              () =>
                                setPlatformWorkspaceAutopay(workspace.workspaceId, {
                                  enabled: e.target.checked,
                                }),
                              e.target.checked
                                ? "автосписание включено"
                                : "автосписание выключено",
                            )
                          }
                        />
                        <span>Автосписание</span>
                      </label>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void retryCharge()}
                      >
                        Повторить списание сейчас
                      </Button>
                    </div>
                    {view.autopay.failedAttempts > 0 && (
                      <p className="text-xs text-destructive">
                        {view.autopay.failedAttempts}{" "}
                        {pluralRu(
                          view.autopay.failedAttempts,
                          "неудачная попытка",
                          "неудачные попытки",
                          "неудачных попыток",
                        )}
                        {view.autopay.lastError ? `: ${view.autopay.lastError}` : ""}
                        {view.autopay.nextAttemptAt
                          ? ` · следующая ${formatDay(view.autopay.nextAttemptAt)}`
                          : ""}
                      </p>
                    )}
                  </div>
                )}
                {paymentNotice && (
                  <p
                    className={`rounded-md border px-3 py-2 text-xs ${BANNER_TONE_CLASS[paymentNotice.tone]}`}
                  >
                    {paymentNotice.text}
                  </p>
                )}
                {payments === null ? null : payments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Платежей картой не было.</p>
                ) : (
                  <PaymentsTable
                    payments={payments}
                    actions={(p) =>
                      refundableAmount(p) > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => startRefund(p)}
                        >
                          Вернуть
                        </Button>
                      )
                    }
                  />
                )}
                {refund && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
                    <Field
                      label={`Сумма, ₽ (пусто — всё: ${formatAmount(refund.max, refund.currency)})`}
                    >
                      <input
                        className={`${inputClsFull} w-32`}
                        inputMode="numeric"
                        value={refund.amount}
                        placeholder={String(refund.max)}
                        onChange={(e) => setRefund({ ...refund, amount: e.target.value })}
                      />
                    </Field>
                    <label className="min-w-48 flex-1 space-y-1">
                      <span className="block text-xs text-muted-foreground">Причина</span>
                      <input
                        className={inputClsFull}
                        value={refund.reason}
                        maxLength={500}
                        onChange={(e) => setRefund({ ...refund, reason: e.target.value })}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || parseRefundAmount(refund.amount, refund.max) === null}
                      onClick={() => void submitRefund()}
                    >
                      Вернуть
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setRefund(null)}
                    >
                      Отмена
                    </Button>
                  </div>
                )}
              </section>

              <PlatformPromoPresets
                workspaceId={workspace.workspaceId}
                busy={busy}
                onApplied={async (next, summary) => {
                  applyCard(next)
                  await onChanged(`«${workspace.name}»: ${summary}.`)
                }}
              />

              <section className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Цена</div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Своя цена в месяц, ₽ (вместо тарифа)">
                      <input
                        className={`${inputClsFull} w-32`}
                        inputMode="numeric"
                        value={customPrice}
                        placeholder="по тарифу"
                        onChange={(e) => setCustomPrice(e.target.value)}
                      />
                    </Field>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || priceValue === null}
                      onClick={() =>
                        act(
                          { kind: "setCustomPrice", customMonthlyPrice: priceValue },
                          `своя цена ${priceValue} ₽/мес`,
                        )
                      }
                    >
                      Сохранить
                    </Button>
                    {card.overrides.customMonthlyPrice !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          act(
                            { kind: "setCustomPrice", customMonthlyPrice: null },
                            "цена снова по тарифу",
                          )
                        }
                      >
                        Сбросить
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Скидка, %">
                      <input
                        className={`${inputClsFull} w-20`}
                        inputMode="numeric"
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                      />
                    </Field>
                    <Field label="До (необязательно)">
                      <input
                        type="date"
                        className={`${inputClsFull} w-40`}
                        value={discountUntil}
                        onChange={(e) => setDiscountUntil(e.target.value)}
                      />
                    </Field>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy ||
                        discountValue === null ||
                        (discountValue === card.overrides.discountPercent &&
                          discountUntil === toDateInput(card.overrides.discountUntil))
                      }
                      onClick={() =>
                        discountValue !== null &&
                        act(
                          {
                            kind: "setDiscount",
                            discountPercent: discountValue,
                            discountUntil: discountUntil || null,
                          },
                          `скидка ${discountValue}%${
                            discountUntil ? ` до ${formatDay(discountUntil)}` : ""
                          }`,
                        )
                      }
                    >
                      Сохранить
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Бесплатно до (включительно)">
                      <input
                        type="date"
                        className={`${inputClsFull} w-40`}
                        value={freeUntil}
                        onChange={(e) => setFreeUntil(e.target.value)}
                      />
                    </Field>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !freeUntil}
                      onClick={() =>
                        act(
                          { kind: "setFreeUntil", freeUntil },
                          `бесплатно до ${formatDay(freeUntil)}`,
                        )
                      }
                    >
                      Сохранить
                    </Button>
                    {card.overrides.freeUntil !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          act({ kind: "setFreeUntil", freeUntil: null }, "бесплатный период снят")
                        }
                      >
                        Снять
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={card.overrides.setupFeeWaived}
                      disabled={busy}
                      onChange={(e) =>
                        act(
                          { kind: "setSetupFeeWaived", setupFeeWaived: e.target.checked },
                          e.target.checked
                            ? "плата за подключение не берётся"
                            : "плата за подключение берётся",
                        )
                      }
                    />
                    <span>Без платы за подключение</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span>Период оплаты</span>
                    <select
                      className={`${inputClsFull} w-36`}
                      value={card.overrides.billingPeriodMonths}
                      disabled={busy}
                      onChange={(e) => {
                        const months = Number(e.target.value)
                        void act(
                          { kind: "setBillingPeriod", billingPeriodMonths: months },
                          months === 12 ? "оплата за год" : "оплата помесячно",
                        )
                      }}
                    >
                      <option value={1}>Помесячно</option>
                      <option value={12}>За год</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Модули</div>
                <ul className="divide-y rounded-md border bg-card">
                  {view.modules.map((m) => {
                    const draft = modules[m.code]
                    if (!draft) return null
                    const patch = (p: Partial<ModuleDraft>) =>
                      setModules((all) => ({ ...all, [m.code]: { ...draft, ...p } }))
                    const priceOk =
                      draft.mode !== "PAID" ||
                      draft.customPrice.trim() === "" ||
                      parseIntIn(draft.customPrice, 0, 10_000_000) !== null
                    const dateOk = draft.mode !== "COMP" || draft.compUntil !== ""
                    return (
                      <li key={m.code} className="space-y-2 p-3">
                        <div className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="font-medium">{m.name}</span>
                          <span className="rounded-full border px-2 py-0.5 text-xs">
                            {moduleStateLabel(m, view.status)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatAmount(m.priceMonthly, currency)} / мес
                            {m.priceMonthly !== m.defaultPriceMonthly
                              ? ` (обычно ${formatAmount(m.defaultPriceMonthly, currency)})`
                              : ""}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="Режим">
                            <select
                              className={`${inputClsFull} w-40`}
                              value={draft.mode}
                              onChange={(e) =>
                                patch({ mode: e.target.value as ModuleModeChoice })
                              }
                            >
                              {MODE_CHOICES.map((mode) => (
                                <option key={mode} value={mode}>
                                  {mode === "COMP" ? "Бесплатно до…" : MODULE_MODE_LABEL[mode]}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {draft.mode === "COMP" && (
                            <Field label="До (включительно)">
                              <input
                                type="date"
                                className={`${inputClsFull} w-40`}
                                value={draft.compUntil}
                                onChange={(e) => patch({ compUntil: e.target.value })}
                              />
                            </Field>
                          )}
                          {draft.mode === "PAID" && (
                            <Field label="Своя цена, ₽/мес">
                              <input
                                className={`${inputClsFull} w-28`}
                                inputMode="numeric"
                                placeholder={String(m.defaultPriceMonthly)}
                                value={draft.customPrice}
                                onChange={(e) => patch({ customPrice: e.target.value })}
                              />
                            </Field>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || !priceOk || !dateOk}
                            onClick={() => void setModule(m.code, m.name)}
                          >
                            Применить
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <PlatformAppSections
                workspaceId={workspace.workspaceId}
                card={card}
                busy={busy}
                run={run}
              />

              <section className="flex flex-wrap items-end gap-2">
                <label className="min-w-64 flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Заметки (счёт, договорённости)
                  </span>
                  <input
                    className={inputClsFull}
                    value={notes}
                    maxLength={2000}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act({ kind: "setNotes", notes }, "заметки сохранены")}
                >
                  Сохранить заметки
                </Button>
              </section>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Оплата картой и автосписания идут через ЮKassa; оплату по счёту вне
                ClubSpace записывает «Отметить оплату». Неоплаченный клуб переходит в
                «Ожидает оплаты», а после льготного периода приостанавливается
                автоматически.
              </p>

              <section className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">История</div>
                {card.audit.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Пока пусто.</p>
                ) : (
                  <ul className="divide-y rounded-md border bg-card">
                    {card.audit.map((e) => {
                      const detail = describeAudit(e)
                      return (
                        <li key={e.id} className="flex flex-wrap gap-x-2 px-3 py-2 text-xs">
                          <span className="font-medium">{auditActionLabel(e)}</span>
                          {detail && <span className="text-muted-foreground">{detail}</span>}
                          <span className="ml-auto shrink-0 text-muted-foreground">
                            {e.actorLabel ?? "—"} · {fmtAuditWhen(e.createdAt)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
