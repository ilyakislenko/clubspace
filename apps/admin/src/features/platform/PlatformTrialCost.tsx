"use client"

import type {
  PlatformWorkspaceBillingCard,
  UpdatePlatformWorkspaceBillingBody,
} from "../../shared/api/platform"
import { inputClsFull } from "../../shared/lib/input-class"
import { formatAmount } from "../subscriptions/subscription-display"
import { formatBytes, formatDay, formatHours } from "../billing/billing-view"

type CardTrialChoice = "DEFAULT" | "ON" | "OFF"

const CHOICE_VALUE: Record<CardTrialChoice, boolean | null> = {
  DEFAULT: null,
  ON: true,
  OFF: false,
}

// The console card's trial block: what the club's trial has cost the platform
// so far (an estimate), and the «пробный период с картой» switch — null
// follows the platform default.
export function PlatformTrialCost({
  card,
  busy,
  act,
}: {
  card: PlatformWorkspaceBillingCard
  busy: boolean
  act: (body: UpdatePlatformWorkspaceBillingBody, done: string) => Promise<void>
}) {
  const cost = card.trialCost
  const override = card.overrides.cardTrial
  // The effective value; with no override it is the platform default.
  const effective = card.billing.trial.cardTrial
  const choice: CardTrialChoice = override === null ? "DEFAULT" : override ? "ON" : "OFF"
  const currency = card.billing.quote.currency

  const change = (next: CardTrialChoice) => {
    const cardTrial = CHOICE_VALUE[next]
    void act(
      { kind: "setCardTrial", cardTrial },
      cardTrial === null
        ? "пробный период с картой — по умолчанию"
        : `пробный период с картой ${cardTrial ? "включён" : "выключен"}`,
    )
  }

  return (
    <section className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Стоимость пробного периода</div>
      <div className="space-y-1 rounded-md border bg-card p-3 text-sm">
        <div className="text-xs text-muted-foreground">
          {formatDay(cost.startedAt)}
          {cost.endsAt ? ` – ${formatDay(cost.endsAt)}` : ""}
          {cost.inTrial ? " · идёт сейчас" : ""}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{cost.days} дн.</span>
          <span>активных {cost.activeMembers}</span>
          <span>писем {cost.emailsSent}</span>
          <span>видео {formatBytes(cost.storageBytes)}</span>
          <span>просмотров {formatHours(cost.viewedSeconds)} ч</span>
          <span className="font-medium">≈ {formatAmount(cost.estimatedCost, currency)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Оплатил: {cost.convertedAt ? formatDay(cost.convertedAt) : "нет"}
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Пробный период с картой</span>
        <select
          className={`${inputClsFull} w-64`}
          value={choice}
          disabled={busy}
          onChange={(e) => change(e.target.value as CardTrialChoice)}
        >
          <option value="DEFAULT">
            {override === null
              ? `По умолчанию (сейчас: ${effective ? "вкл" : "выкл"})`
              : "По умолчанию"}
          </option>
          <option value="ON">Включён</option>
          <option value="OFF">Выключен</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Клуб на пробном периоде без карты может привязать её (проверочное списание
        сразу возвращается) — тогда первый платёж спишется автоматически.
      </p>
    </section>
  )
}
