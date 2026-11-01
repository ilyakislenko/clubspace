import type { BillingQuote } from "../../shared/api/billing"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"
import { formatDay } from "./billing-view"

// The next charge as the API computed it: lines, discounts, total. Shared by
// the club's «Тариф» page and the platform console.
export function QuoteSummary({
  quote,
  nextChargeAt,
}: {
  quote: BillingQuote
  nextChargeAt: string | null
}) {
  const money = (n: number) => formatAmount(n, quote.currency)
  const period =
    quote.periodMonths === 12
      ? "Оплата за год"
      : quote.periodMonths === 1
        ? "Оплата за месяц"
        : `Оплата за ${quote.periodMonths} ${pluralRu(quote.periodMonths, "месяц", "месяца", "месяцев")}`
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {period}
        {nextChargeAt ? ` · следующее списание ${formatDay(nextChargeAt)}` : ""}
      </div>
      <ul className="space-y-1 text-sm">
        {quote.lines.map((line) => (
          <li key={line.code} className="flex justify-between gap-4">
            <span>{line.title}</span>
            <span className="shrink-0 tabular-nums">{money(line.amount)}</span>
          </li>
        ))}
        {quote.discounts.length > 0 && (
          <li className="flex justify-between gap-4 border-t pt-1 text-muted-foreground">
            <span>Без скидок</span>
            <span className="shrink-0 tabular-nums">{money(quote.subtotal)}</span>
          </li>
        )}
        {quote.discounts.map((d) => (
          <li key={d.code} className="flex justify-between gap-4 text-emerald-700">
            <span>{d.title}</span>
            <span className="shrink-0 tabular-nums">−{money(d.amount)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-4 border-t pt-2 font-semibold">
          <span>Итого</span>
          <span className="shrink-0 tabular-nums">{money(quote.total)}</span>
        </li>
      </ul>
    </div>
  )
}
