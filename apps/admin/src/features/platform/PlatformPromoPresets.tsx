"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  applyPlatformWorkspacePromo,
  previewPlatformWorkspacePromo,
  type PlatformWorkspaceBillingCard,
  type PlatformWorkspacePromoBody,
  type PlatformWorkspacePromoPreview,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { formatAmount } from "../subscriptions/subscription-display"
import { formatDay } from "../billing/billing-view"
import { QuoteSummary } from "../billing/QuoteSummary"

// Whole number in [min, max] or null.
const intIn = (raw: string, min: number, max: number): number | null => {
  const n = Number(raw.trim())
  return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null
}

// One-click promos in the console card. A click asks the server what the next
// charge would become; the operator confirms with the quote in front of them.
// Each preset only sets existing overrides (free period, VIDEO comp, a timed
// discount, the setup fee), and the server audits it.
export function PlatformPromoPresets({
  workspaceId,
  busy,
  onApplied,
}: {
  workspaceId: string
  busy: boolean
  onApplied: (card: PlatformWorkspaceBillingCard, summary: string) => Promise<void>
}) {
  const [videoMonths, setVideoMonths] = useState("3")
  const [discountPercent, setDiscountPercent] = useState("20")
  const [discountMonths, setDiscountMonths] = useState("3")
  const [pending, setPending] = useState<{
    body: PlatformWorkspacePromoBody
    preview: PlatformWorkspacePromoPreview
  } | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const videoN = intIn(videoMonths, 1, 24)
  const discountP = intIn(discountPercent, 1, 100)
  const discountN = intIn(discountMonths, 1, 24)
  const disabled = busy || working

  const ask = async (body: PlatformWorkspacePromoBody) => {
    setWorking(true)
    setError(null)
    try {
      setPending({ body, preview: await previewPlatformWorkspacePromo(workspaceId, body) })
    } catch (e) {
      setError(errorMessage(e, "Не удалось посчитать промо."))
    } finally {
      setWorking(false)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setWorking(true)
    setError(null)
    try {
      const card = await applyPlatformWorkspacePromo(workspaceId, pending.body)
      const { summary } = pending.preview
      setPending(null)
      await onApplied(card, summary)
    } catch (e) {
      setError(errorMessage(e, "Не удалось применить промо."))
    } finally {
      setWorking(false)
    }
  }

  const charge = (side: PlatformWorkspacePromoPreview["current"]) =>
    `${formatAmount(side.quote.total, side.quote.currency)}${
      side.nextChargeAt ? ` · ${formatDay(side.nextChargeAt)}` : ""
    }`

  return (
    <section className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Промо в один клик</div>
      <div className="flex flex-wrap items-end gap-2">
        {[1, 2, 3].map((months) => (
          <Button
            key={months}
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void ask({ preset: "FREE_MONTHS", months })}
          >
            {months === 1 ? "1 месяц" : `${months} месяца`} бесплатно
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => void ask({ preset: "NO_SETUP_FEE" })}
        >
          Без платы за подключение
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Месяцев</span>
            <input
              className={`${inputClsFull} w-16`}
              inputMode="numeric"
              value={videoMonths}
              onChange={(e) => setVideoMonths(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || videoN === null}
            onClick={() =>
              videoN !== null && void ask({ preset: "VIDEO_GIFT", months: videoN })
            }
          >
            Видео в подарок на {videoN ?? "N"} мес.
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Скидка, %</span>
            <input
              className={`${inputClsFull} w-16`}
              inputMode="numeric"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Месяцев</span>
            <input
              className={`${inputClsFull} w-16`}
              inputMode="numeric"
              value={discountMonths}
              onChange={(e) => setDiscountMonths(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || discountP === null || discountN === null}
            onClick={() =>
              discountP !== null &&
              discountN !== null &&
              void ask({ preset: "DISCOUNT", months: discountN, discountPercent: discountP })
            }
          >
            Скидка {discountP ?? "N"}% на {discountN ?? "N"} мес.
          </Button>
        </div>
      </div>

      {pending && (
        <div className="space-y-3 rounded-md border bg-card p-3">
          <div className="text-sm font-medium">{pending.preview.summary}</div>
          <div className="text-xs text-muted-foreground">
            Следующий счёт сейчас: {charge(pending.preview.current)} → после промо:{" "}
            <span className="font-medium text-foreground">
              {charge(pending.preview.next)}
            </span>
          </div>
          <QuoteSummary
            quote={pending.preview.next.quote}
            nextChargeAt={pending.preview.next.nextChargeAt}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={disabled} onClick={() => void confirm()}>
              Применить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setPending(null)}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  )
}
