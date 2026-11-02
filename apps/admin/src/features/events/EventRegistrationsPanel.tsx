"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  listEventRegistrations,
  markEventRegistrationPaid,
  unmarkEventRegistrationPaid,
  type EventPaymentMethod,
  type EventRegistrant,
  type EventRegistrations,
} from "../../shared/api/events"
import { errorMessage } from "../../shared/lib/error-message"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { formatAmount } from "../subscriptions/subscription-display"

const METHOD_LABEL: Record<EventPaymentMethod, string> = {
  CASH: "наличные",
  TRANSFER: "перевод",
}

const statusLabel = (r: EventRegistrant): string =>
  r.status === "BOOKED"
    ? "Место"
    : r.status === "WAITLISTED"
      ? `Лист ожидания · ${r.waitlistPosition ?? "—"}`
      : "Запись отменена"

type Props = {
  workspaceId: string
  eventId: string
  // Unmarking a payment is admin-only (the server gates it the same way).
  canUnmark: boolean
}

// Who registered for a master class (an event with a price or a limit of
// places) and who paid at the club — cash or a transfer. Own fetch; refreshes
// live as members register, cancel and move up from the waitlist.
export function EventRegistrationsPanel({ workspaceId, eventId, canUnmark }: Props) {
  const [data, setData] = useState<EventRegistrations | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const act = async (r: EventRegistrant, run: () => Promise<unknown>) => {
    setBusyId(r.id)
    setError(null)
    try {
      await run()
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить оплату"))
    } finally {
      setBusyId(null)
    }
  }

  const markPaid = (r: EventRegistrant, method: EventPaymentMethod) =>
    act(r, () =>
      markEventRegistrationPaid({ workspaceId, registrationId: r.id, method }),
    )
  const unmark = (r: EventRegistrant) => {
    if (!window.confirm(`Снять отметку об оплате у «${r.name}»?`)) return
    void act(r, () =>
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
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Оплачено
                      {r.amountPaid !== null && r.currency
                        ? ` ${formatAmount(r.amountPaid, r.currency)}`
                        : ""}
                      {r.paymentMethod
                        ? ` · ${METHOD_LABEL[r.paymentMethod]}`
                        : ""}
                    </span>
                    {r.status === "CANCELLED" && (
                      <span className="text-xs text-muted-foreground">
                        запись отменена — верните деньги и снимите отметку
                      </span>
                    )}
                    {canUnmark && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === r.id}
                        onClick={() => unmark(r)}
                      >
                        Снять
                      </Button>
                    )}
                  </div>
                ) : r.status === "BOOKED" ? (
                  // Payment is taken for a place: the waitlist pays once moved up.
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Оплата на месте:
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busyId === r.id}
                      onClick={() => void markPaid(r, "CASH")}
                    >
                      Наличные
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busyId === r.id}
                      onClick={() => void markPaid(r, "TRANSFER")}
                    >
                      Перевод
                    </Button>
                  </div>
                ) : null)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
