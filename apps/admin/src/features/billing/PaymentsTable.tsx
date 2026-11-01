import type { ReactNode } from "react"

import type { BillingPayment } from "../../shared/api/billing"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  formatShortDate,
  PAYMENT_INITIATOR_LABEL,
  PAYMENT_STATUS_CLASS,
  paymentFailure,
  paymentStatusLabel,
  paymentSubject,
} from "./billing-view"

// The club's card payments to ClubSpace, newest first. Shared by the club's
// «Тариф» page and the platform console (which adds a refund action per row).
export function PaymentsTable({
  payments,
  actions,
}: {
  payments: BillingPayment[]
  actions?: (p: BillingPayment) => ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Дата</th>
            <th className="px-3 py-2 font-medium">Что</th>
            <th className="px-3 py-2 text-right font-medium">Сумма</th>
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Карта</th>
            {actions && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((p) => {
            const failure = paymentFailure(p)
            const receiptSent =
              p.receiptEmail !== null && (p.status === "SUCCEEDED" || p.status === "REFUNDED")
            return (
              <tr key={p.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  {formatShortDate(p.paidAt ?? p.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <div>{paymentSubject(p)}</div>
                  <div className="text-xs text-muted-foreground">
                    {PAYMENT_INITIATOR_LABEL[p.initiator]}
                    {p.periodStart && p.periodEnd
                      ? ` · ${formatShortDate(p.periodStart)} – ${formatShortDate(p.periodEnd)}`
                      : ""}
                  </div>
                  {receiptSent && (
                    <div className="text-xs text-muted-foreground">
                      Чек отправлен на {p.receiptEmail}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  <div>{formatAmount(p.amount, p.currency)}</div>
                  {p.refundedAmount > 0 && (
                    <div className="text-xs text-muted-foreground">
                      возвращено {formatAmount(p.refundedAmount, p.currency)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${PAYMENT_STATUS_CLASS[p.status]}`}
                  >
                    {paymentStatusLabel(p)}
                  </span>
                  {failure && <div className="mt-1 text-xs text-destructive">{failure}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {p.cardLast4
                    ? `${p.cardTitle ? `${p.cardTitle} ` : ""}•••• ${p.cardLast4}`
                    : "—"}
                </td>
                {actions && <td className="px-3 py-2 text-right">{actions(p)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
