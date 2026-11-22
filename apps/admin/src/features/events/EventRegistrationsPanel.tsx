"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { listSaleDiscounts } from "../../shared/api/discounts"
import {
  listEventRegistrations,
  markEventRegistrationPaid,
  unmarkEventRegistrationPaid,
  type EventRegistrant,
  type EventRegistrations,
} from "../../shared/api/events"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { isClubAdmin } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import {
  discountChoices,
  preselectedChoice,
  type DiscountChoice,
} from "../discounts/discount-view"
import { MarkPaidForm } from "../subscriptions/MarkPaidForm"
import { PAYMENT_METHOD_LABEL, type ClubPaymentMethod } from "../subscriptions/payment-method"
import {
  canUndoPaymentMark,
  formatAmount,
  saleDiscountText,
  ticketEntryHref,
} from "../subscriptions/subscription-display"

const statusLabel = (r: EventRegistrant): string =>
  r.status === "BOOKED"
    ? "Место"
    : r.status === "WAITLISTED"
      ? `Лист ожидания · ${r.waitlistPosition ?? "—"}`
      : "Запись отменена"

type Props = {
  workspaceId: string
  eventId: string
  // Unmarking a payment is the sport leads' (the server gates it the same way).
  canUnmark: boolean
}

// Who registered for a master class (an event with a price or a limit of
// places) and who paid — at the club (cash / a transfer, marked here) or
// online (marked by the payment). Money goes back from the ticket's row in
// «Платежи». Own fetch; refreshes live as members register, cancel and move
// up from the waitlist.
export function EventRegistrationsPanel({ workspaceId, eventId, canUnmark }: Props) {
  // Refunds («Платежи») are the club admins'.
  const canRefund = isClubAdmin(useMyMembership(workspaceId))
  const [data, setData] = useState<EventRegistrations | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // The ticket whose «Отметить оплату» form is open, and its «Скидка»
  // choices (null while they load).
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payChoices, setPayChoices] = useState<DiscountChoice[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      setData(await listEventRegistrations({ workspaceId, eventId }))
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить записавшихся"))
    }
  }, [workspaceId, eventId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useWorkspaceRealtime(workspaceId, ["eventregistrations"], () => void refresh())

  // True once saved; a refusal shows above the list.
  const act = async (r: EventRegistrant, run: () => Promise<unknown>): Promise<boolean> => {
    setBusyId(r.id)
    setError(null)
    try {
      await run()
      await refresh()
      return true
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить оплату"))
      return false
    } finally {
      setBusyId(null)
    }
  }

  // The form opens once the discounts for this member and event are in; a
  // member the viewer may not sell to gets the form without them.
  const openPay = (r: EventRegistrant) => {
    setPayingId(r.id)
    setPayChoices(null)
    void listSaleDiscounts({ workspaceId, userId: r.userId, eventId })
      .then((res) => discountChoices(res.options, { eventId }))
      .catch(() => [])
      .then(setPayChoices)
  }
  const markPaid = async (
    r: EventRegistrant,
    amount: number | null,
    method: ClubPaymentMethod,
    discountId: string | null,
  ) => {
    const saved = await act(r, () =>
      markEventRegistrationPaid({
        workspaceId,
        registrationId: r.id,
        data: {
          method,
          ...(amount !== null ? { amount } : {}),
          ...(discountId ? { discountId } : {}),
        },
      }),
    )
    if (saved) setPayingId(null)
  }
  const unmark = async (r: EventRegistrant) => {
    if (
      !(await confirmDialog({
        title: `Снять отметку об оплате у «${r.name}»?`,
        description: `${
          r.amountPaid !== null && r.currency
            ? `Оплата ${formatAmount(r.amountPaid, r.currency)}`
            : "Оплата"
        } перестанет учитываться в выручке${
          r.status === "BOOKED" ? ", место останется за участником" : ""
        }.`,
        confirmLabel: "Снять отметку",
      }))
    )
      return
    await act(r, () =>
      unmarkEventRegistrationPaid({ workspaceId, registrationId: r.id }),
    )
  }

  if (!data) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <div className="h-16 animate-pulse rounded-md bg-muted" />
    )
  }

  const paid = data.price !== null
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          Места:{" "}
          <b className="tabular-nums">
            {data.capacity !== null
              ? `${data.booked} из ${data.capacity}`
              : data.booked}
          </b>
        </span>
        {data.waitlist > 0 && (
          <span>
            Лист ожидания: <b className="tabular-nums">{data.waitlist}</b>
          </span>
        )}
        {paid && (
          <span>
            Оплачено:{" "}
            <b className="tabular-nums">
              {data.paid.count} ·{" "}
              {formatAmount(data.paid.amount, data.currency)}
            </b>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Пока никто не записался.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.data.map((r) => (
            <li
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${
                r.status === "CANCELLED" && !r.isPaid ? "opacity-60" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {statusLabel(r)}
                  {r.promotedAt && r.status === "BOOKED"
                    ? " · из листа ожидания"
                    : ""}
                  {r.bookedByOther ? " · записал родитель" : ""}
                </div>
              </div>
              {paid &&
                (r.isPaid ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Оплачено
                      {r.amountPaid !== null && r.currency
                        ? ` ${formatAmount(r.amountPaid, r.currency)}`
                        : ""}
                      {r.paymentMethod
                        ? ` · ${PAYMENT_METHOD_LABEL[r.paymentMethod].toLowerCase()}`
                        : ""}
                    </span>
                    {r.refundedAmount > 0 && r.currency && (
                      <span className="text-xs text-muted-foreground">
                        возвращено {formatAmount(r.refundedAmount, r.currency)}
                      </span>
                    )}
                    {(() => {
                      const discount = saleDiscountText({ ...r, currency: r.currency ?? data.currency })
                      return discount ? (
                        <span className="text-xs text-muted-foreground">
                          {discount.charAt(0).toUpperCase() + discount.slice(1)}
                        </span>
                      ) : null
                    })()}
                    {r.status === "CANCELLED" &&
                      (r.amountPaid === null || r.refundedAmount < r.amountPaid) &&
                      (canRefund ? (
                        <Link
                          href={ticketEntryHref(workspaceId, r.id)}
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          запись отменена — верните деньги
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          запись отменена — верните деньги и снимите отметку
                        </span>
                      ))}
                    {canUnmark && canUndoPaymentMark(r) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === r.id}
                        onClick={() => void unmark(r)}
                      >
                        Снять
                      </Button>
                    ) : (
                      // Paid online or already partly returned: the mark
                      // stays; the money goes back from the ticket's row.
                      canRefund &&
                      r.status !== "CANCELLED" && (
                        <Link
                          href={ticketEntryHref(workspaceId, r.id)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Возврат — в «Абонементы → Платежи»
                        </Link>
                      )
                    )}
                  </div>
                ) : r.status === "BOOKED" && payingId !== r.id ? (
                  // Payment is taken for a place: the waitlist pays once moved up.
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyId === r.id || payingId !== null}
                    onClick={() => openPay(r)}
                  >
                    Отметить оплату
                  </Button>
                ) : null)}
              {paid && data.price !== null && payingId === r.id && !r.isPaid && (
                <div className="basis-full">
                  {payChoices === null ? (
                    <div className="h-24 animate-pulse rounded-md bg-muted" />
                  ) : (
                    <MarkPaidForm
                      amount={data.price}
                      currency={data.currency}
                      basePrice={data.price}
                      choices={payChoices}
                      preselect={preselectedChoice(payChoices)}
                      limit={FORM_LIMITS.payment.ticketAmount}
                      busy={busyId === r.id}
                      onSubmit={(amount, method, discountId) =>
                        void markPaid(r, amount, method, discountId)
                      }
                      onCancel={() => setPayingId(null)}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
