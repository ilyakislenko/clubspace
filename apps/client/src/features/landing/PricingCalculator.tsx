"use client"

import { useEffect, useState } from "react"

import {
  quotePublicPricing,
  type PricingModuleCode,
  type PricingQuote,
  type PublicPricing,
} from "../../shared/api/pricing"
import { errorMessage } from "../../shared/lib/error-message"
import { pluralRu, rub } from "./format"

const DEBOUNCE_MS = 250
const DEFAULT_STUDENTS = 80

// «Сколько это будет стоить»: the visitor's numbers, priced by the server with
// the very quote a club's bill comes from (POST /public/pricing/quote). No
// prices are computed here, so the calculator can never disagree with a bill.
export function PricingCalculator({ pricing }: { pricing: PublicPricing }) {
  const lastFinite = pricing.tiers.reduce(
    (max, t) => (t.upTo !== null && t.upTo > max ? t.upTo : max),
    0,
  )
  const sliderMax = Math.max(100, lastFinite + 200)

  const [students, setStudents] = useState(DEFAULT_STUDENTS)
  const [modules, setModules] = useState<PricingModuleCode[]>([])
  const [annual, setAnnual] = useState(false)
  const [quote, setQuote] = useState<PricingQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      quotePublicPricing({
        activeMembers: students,
        modules,
        periodMonths: annual ? 12 : 1,
      })
        .then((q) => {
          if (!alive) return
          setQuote(q)
          setError(null)
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e, "Не удалось посчитать стоимость."))
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [students, modules, annual])

  const toggleModule = (code: PricingModuleCode) =>
    setModules((all) =>
      all.includes(code) ? all.filter((c) => c !== code) : [...all, code],
    )

  const setStudentsClamped = (raw: string) => {
    const n = Math.floor(Number(raw))
    setStudents(Number.isFinite(n) ? Math.min(100_000, Math.max(0, n)) : 0)
  }

  const tier = quote
    ? pricing.tiers.find((t) => t.code === quote.quote.tierCode)
    : undefined
  const setupLine = quote?.quote.lines.find((l) => l.code === "setup")

  return (
    <div className="grid gap-6 rounded-2xl border border-border bg-card p-5 md:grid-cols-2 md:p-8">
      <div className="space-y-6">
        <div className="space-y-3">
          <label htmlFor="calc-students" className="block text-sm font-medium">
            Активных учеников
          </label>
          <div className="flex items-center gap-3">
            <input
              id="calc-students"
              type="range"
              min={1}
              max={sliderMax}
              step={1}
              value={Math.min(students, sliderMax)}
              onChange={(e) => setStudentsClamped(e.target.value)}
              className="h-2 w-full cursor-pointer accent-primary"
            />
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              value={students}
              aria-label="Активных учеников, число"
              onChange={(e) => setStudentsClamped(e.target.value)}
              className="h-10 w-24 rounded-md border border-border bg-background px-2 text-right text-sm"
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Модули</legend>
          {pricing.modules.map((m) => (
            <label
              key={m.code}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <input
                type="checkbox"
                checked={modules.includes(m.code)}
                onChange={() => toggleModule(m.code)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="flex-1">
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {m.includes.join(" · ")}
                </span>
              </span>
              <span className="whitespace-nowrap">{rub(m.priceMonthly)}/мес</span>
            </label>
          ))}
        </fieldset>

        <div
          role="radiogroup"
          aria-label="Период оплаты"
          className="inline-flex rounded-full border border-border p-1 text-sm"
        >
          {[
            { value: false, label: "Помесячно" },
            {
              value: true,
              label: `За год −${pricing.annualDiscountPercent}%`,
            },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={annual === o.value}
              onClick={() => setAnnual(o.value)}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                annual === o.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div
        aria-live="polite"
        className={`flex flex-col justify-between gap-4 rounded-xl bg-muted p-5 transition-opacity ${
          loading ? "opacity-60" : ""
        }`}
      >
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !quote ? (
          <p className="text-sm text-muted-foreground">Считаем…</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {tier ? `Тариф «${tier.name}»` : "Тариф"} · {students}{" "}
                {pluralRu(students, "ученик", "ученика", "учеников")}
              </p>
              <p className="text-4xl font-semibold tracking-tight">
                {rub(quote.perMonth)}
                <span className="text-base font-normal text-muted-foreground"> в месяц</span>
              </p>
              {annual && (
                <p className="text-sm text-muted-foreground">
                  {rub(quote.renewal)} за год со скидкой {pricing.annualDiscountPercent}%
                </p>
              )}
            </div>

            <ul className="space-y-1 text-sm">
              {quote.quote.lines.map((l) => (
                <li key={l.code} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{l.title}</span>
                  <span className="whitespace-nowrap">{rub(l.amount)}</span>
                </li>
              ))}
              {quote.quote.discounts.map((d) => (
                <li key={d.code} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{d.title}</span>
                  <span className="whitespace-nowrap">−{rub(d.amount)}</span>
                </li>
              ))}
            </ul>

            <div className="space-y-1 border-t border-border pt-3 text-sm">
              <p className="flex justify-between gap-4 font-medium">
                <span>Первый платёж после пробного периода</span>
                <span className="whitespace-nowrap">{rub(quote.quote.total)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {pricing.trialDays} {pluralRu(pricing.trialDays, "день", "дня", "дней")}{" "}
                бесплатно со всеми модулями.
                {setupLine ? ` Подключение ${rub(setupLine.amount)} — один раз, с первым платежом.` : ""}{" "}
                Дальше — {rub(quote.renewal)} {annual ? "в год" : "в месяц"}.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
