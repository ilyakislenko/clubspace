"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  approveSubscriptionFreezeRequest,
  declineSubscriptionFreezeRequest,
  endSubscriptionFreeze,
  freezeSubscription,
  type MemberSubscriptions,
} from "../../shared/api/subscriptions"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
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
// planned freeze with a way to end it, or a form to start one. While the
// member's own request is pending it is decided here instead (approving opens
// the same form, prefilled). Refetching and the "Доступ до" refresh are the
// parent's job (`onChanged`).
export function SubscriptionFreezeBlock({
  workspaceId,
  userId,
  current,
  freezes,
  freezeRequest,
  onChanged,
}: {
  workspaceId: string
  userId: string
  current: NonNullable<MemberSubscriptions["current"]>
  freezes: MemberSubscriptions["freezes"]
  freezeRequest: MemberSubscriptions["freezeRequest"]
  onChanged: () => Promise<void>
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [declineComment, setDeclineComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = todayYmd(new Date())
  const open = openFreezeOf(freezes, current.id, today)
  const phase = open ? freezePhase(open, today) : null
  const total = totalFrozenDays(freezes, current.id)
  const request = freezeRequest?.status === "PENDING" ? freezeRequest : null

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

  const decide = async (action: () => Promise<unknown>, failed: string) => {
    setBusy(true)
    try {
      await action()
      setError(null)
      setApproveOpen(false)
      setDeclineOpen(false)
      await onChanged()
    } catch (e) {
      setError(errorMessage(e, failed))
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

      {request && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p>
            Участник просит заморозку:{" "}
            {formatDayRange(request.fromDate, request.untilDate)} ·{" "}
            {request.days} дн.
            <span className="text-muted-foreground">
              {" "}
              · {request.reason} · от{" "}
              {new Date(request.createdAt).toLocaleDateString("ru-RU")}
            </span>
          </p>
          {!approveOpen && !declineOpen && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setApproveOpen(true)}
              >
                Одобрить
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDeclineComment("")
                  setDeclineOpen(true)
                }}
              >
                Отклонить
              </Button>
            </div>
          )}
          {approveOpen && (
            <FreezeForm
              endDate={current.endDate}
              initial={{
                days: request.days,
                fromDate: request.fromDate > today ? request.fromDate : today,
                reason: request.reason,
              }}
              submitLabel="Одобрить заморозку"
              busy={busy}
              onCancel={() => setApproveOpen(false)}
              onSubmit={(v) =>
                void decide(
                  () =>
                    approveSubscriptionFreezeRequest({
                      workspaceId,
                      requestId: request.id,
                      data: v,
                    }),
                  "Не удалось одобрить заявку",
                )
              }
            />
          )}
          {declineOpen && (
            <div className="space-y-2">
              <textarea
                className={`${inputClsFull} min-h-20`}
                aria-label="Комментарий к отказу (увидит участник)"
                placeholder="Комментарий (увидит участник)"
                maxLength={500}
                value={declineComment}
                onChange={(e) => setDeclineComment(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Отклонить заявку на заморозку?")) return
                    void decide(
                      () =>
                        declineSubscriptionFreezeRequest({
                          workspaceId,
                          requestId: request.id,
                          data: { comment: declineComment.trim() || undefined },
                        }),
                      "Не удалось отклонить заявку",
                    )
                  }}
                >
                  Отклонить заявку
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDeclineOpen(false)}
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!open && !request && !formOpen && (
        <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
          Заморозить
        </Button>
      )}

      {!open && !request && formOpen && (
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
