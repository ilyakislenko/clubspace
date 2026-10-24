"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  endSubscriptionFreeze,
  freezeSubscription,
  type MemberSubscriptions,
} from "../../shared/api/subscriptions"
import { errorMessage } from "../../shared/lib/error-message"
import { TONE_CLASS } from "../audit/audit-meta"
import { FreezeForm } from "./FreezeForm"
import {
  formatDay,
  formatDayRange,
  freezePhase,
  openFreezeOf,
  returnDaysIfEndedToday,
  todayYmd,
  totalFrozenDays,
} from "./freeze-utils"

// Freeze controls for the member's current abonement: shows the running or
// planned freeze with a way to end it, or a form to start one. Refetching and
// the "Доступ до" refresh are the parent's job (`onChanged`).
export function SubscriptionFreezeBlock({
  workspaceId,
  userId,
  current,
  freezes,
  onChanged,
}: {
  workspaceId: string
  userId: string
  current: NonNullable<MemberSubscriptions["current"]>
  freezes: MemberSubscriptions["freezes"]
  onChanged: () => Promise<void>
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = todayYmd(new Date())
  const open = openFreezeOf(freezes, current.id, today)
  const phase = open ? freezePhase(open, today) : null
  const total = totalFrozenDays(freezes, current.id)

  const end = async (freezeId: string) => {
    setBusy(true)
    try {
      await endSubscriptionFreeze({
        workspaceId,
        userId,
        subscriptionId: current.id,
        freezeId,
      })
      setError(null)
      await onChanged()
    } catch (e) {
      setError(errorMessage(e, "Не удалось снять заморозку"))
    } finally {
      setBusy(false)
    }
  }

  const confirmEnd = (message: string, freezeId: string) => {
    if (!window.confirm(message)) return
    void end(freezeId)
  }

  return (
    <div className="space-y-2 text-sm">
      {error && <p className="text-destructive">{error}</p>}

      {open && phase === "current" && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASS.blue}`}
          >
            Заморожен по {formatDay(open.untilDate)}
          </span>
          <span className="text-muted-foreground">
            с {formatDay(open.fromDate)} · {open.days} дн.
            {open.reason ? ` · ${open.reason}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              confirmEnd(
                `Снять заморозку? Срок абонемента сократится на ${returnDaysIfEndedToday(open, today)} дн. (неиспользованные дни заморозки).`,
                open.id,
              )
            }
          >
            Завершить досрочно
          </Button>
        </div>
      )}

      {open && phase === "upcoming" && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Заморозка запланирована:{" "}
            {formatDayRange(open.fromDate, open.untilDate)}
            <span className="text-muted-foreground">
              {" "}
              · {open.days} дн.
              {open.reason ? ` · ${open.reason}` : ""}
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              confirmEnd(
                `Отменить запланированную заморозку? Срок абонемента сократится на ${open.days} дн.`,
                open.id,
              )
            }
          >
            Отменить заморозку
          </Button>
        </div>
      )}

      {!open && !formOpen && (
        <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
          Заморозить
        </Button>
      )}

      {!open && formOpen && (
        <FreezeForm
          endDate={current.endDate}
          submitLabel="Заморозить"
          busy={busy}
          onCancel={() => setFormOpen(false)}
          onSubmit={(v) => {
            void (async () => {
              setBusy(true)
              try {
                await freezeSubscription({
                  workspaceId,
                  userId,
                  subscriptionId: current.id,
                  data: v,
                })
                setError(null)
                setFormOpen(false)
                await onChanged()
              } catch (e) {
                setError(errorMessage(e, "Не удалось заморозить абонемент"))
              } finally {
                setBusy(false)
              }
            })()
          }}
        />
      )}

      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          Всего заморожено по этому абонементу: {total} дн.
        </p>
      )}
    </div>
  )
}
