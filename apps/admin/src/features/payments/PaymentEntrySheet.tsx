"use client"

import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  getPaymentJournalEntry,
  type PaymentJournalEntryDetail,
  type PaymentJournalUnapplied,
} from "../../shared/api/payment-journal"
import { refundPayment } from "../../shared/api/payments"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  canRefundOnline,
  entryAmount,
  entryTitle,
  entryWhat,
  formatEntryAt,
  methodLabel,
  onlineRefundHint,
} from "./journal-view"
import { PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "./payment-labels"

type Props = {
  workspaceId: string
  timezone: string
  // A journal row (`sub:<uuid>` / `reg:<uuid>`, from `?entry=`), or an online
  // payment that never became a sale (the «не зачислено» strip).
  entryId: string | null
  unapplied: PaymentJournalUnapplied | null
  onClose: () => void
  // A refund went through: the journal reloads.
  onChanged: () => void
}

/** Side panel of one payment: what, when, how, who marked it, the member's card. */
export function PaymentEntrySheet({
  workspaceId,
  timezone,
  entryId,
  unapplied,
  onClose,
  onChanged,
}: Props) {
  return (
    <Sheet open={entryId !== null || unapplied !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        {unapplied ? (
          <UnappliedDetails
            workspaceId={workspaceId}
            timezone={timezone}
            payment={unapplied}
            onRefunded={() => {
              onChanged()
              onClose()
            }}
          />
        ) : entryId ? (
          <EntryDetails
            key={entryId}
            workspaceId={workspaceId}
            timezone={timezone}
            entryId={entryId}
            onChanged={onChanged}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

function EntryDetails({
  workspaceId,
  timezone,
  entryId,
  onChanged,
}: {
  workspaceId: string
  timezone: string
  entryId: string
  onChanged: () => void
}) {
  const [entry, setEntry] = useState<PaymentJournalEntryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getPaymentJournalEntry({ workspaceId, entryId })
      .then((e) => alive && setEntry(e))
      .catch((e) => alive && setError(errorMessage(e, "Не удалось открыть платёж")))
    return () => {
      alive = false
    }
  }, [workspaceId, entryId])

  if (!entry) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Платёж</SheetTitle>
          <SheetDescription className="sr-only">Подробности платежа</SheetDescription>
        </SheetHeader>
        {error ? (
          <ErrorNote message={error} />
        ) : (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        )}
      </>
    )
  }

  const refunded = entry.kind === "payment" && entry.refundedAmount > 0
  const memberCard =
    entry.member.userId && entry.memberHasCard
      ? `/workspace/${workspaceId}/users/${entry.member.userId}`
      : null

  const refund = async () => {
    if (!entry.online) return
    const ok = await confirmDialog({
      title: `Вернуть ${formatAmount(entry.amount, entry.currency)} ученику ${entry.member.name}?`,
      description: `Деньги вернутся тем же способом, которым платил ученик. ${onlineRefundHint(entry)}`,
      confirmLabel: "Вернуть деньги",
      destructive: true,
    })
    if (!ok) return
    setRefunding(true)
    setError(null)
    try {
      await refundPayment({ workspaceId, paymentId: entry.online.paymentId })
      setNotice(`Деньги возвращены. ${onlineRefundHint(entry)}`)
      setEntry({ ...entry, online: { ...entry.online, status: "REFUNDED" } })
      onChanged()
    } catch (e) {
      setError(errorMessage(e, "Не удалось вернуть платёж"))
    } finally {
      setRefunding(false)
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{entryTitle(entry)}</SheetTitle>
        <SheetDescription>{entryWhat(entry)}</SheetDescription>
      </SheetHeader>
      {error && <ErrorNote message={error} />}
      {notice && (
        <p className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <Facts>
        <Fact label="Ученик">
          {memberCard ? (
            <Link href={memberCard} className="font-medium text-primary hover:underline">
              {entry.member.name}
            </Link>
          ) : (
            entry.member.name
          )}
        </Fact>
        <Fact label="Когда">{formatEntryAt(entry.at, timezone)}</Fact>
        <Fact label="Способ">{methodLabel(entry.method)}</Fact>
        {entry.markedBy && (
          <Fact label={entry.kind === "refund" ? "Вернул" : "Отметил"}>{entry.markedBy.name}</Fact>
        )}
        {refunded && (
          <Fact label="Возвращено">{formatAmount(entry.refundedAmount, entry.currency)}</Fact>
        )}
        {entry.online && (
          <Fact label="Онлайн">
            {[
              PROVIDER_LABEL[entry.online.provider],
              entry.online.providerRef ? `№ …${entry.online.providerRef}` : null,
              PAYMENT_STATUS_LABEL[entry.online.status],
            ]
              .filter(Boolean)
              .join(" · ")}
          </Fact>
        )}
        {entry.refundOf && (
          <Fact label="Возврат за">
            оплату {formatAmount(entry.refundOf.amount, entry.currency)} от{" "}
            {formatEntryAt(entry.refundOf.at, timezone)}
          </Fact>
        )}
      </Facts>

      {entry.refunds.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Возвраты</h3>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {entry.refunds.map((r) => (
              <li key={r.id} className="space-y-0.5 px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span>{formatEntryAt(r.at, timezone)}</span>
                  <span className="font-medium tabular-nums text-destructive">{entryAmount(r)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {[methodLabel(r.method), r.markedBy?.name, r.reason].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canRefundOnline(entry) && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={refunding}
          onClick={() => void refund()}
        >
          {refunding ? "Возврат…" : "Вернуть деньги"}
        </Button>
      )}
    </>
  )
}

function UnappliedDetails({
  workspaceId,
  timezone,
  payment,
  onRefunded,
}: {
  workspaceId: string
  timezone: string
  payment: PaymentJournalUnapplied
  onRefunded: () => void
}) {
  const [refunding, setRefunding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amount = formatAmount(payment.amount, payment.currency)

  const refund = async () => {
    const ok = await confirmDialog({
      title: `Вернуть ${amount} ученику ${payment.member.name}?`,
      description: "Деньги вернутся тем же способом, которым платил ученик.",
      confirmLabel: "Вернуть деньги",
      destructive: true,
    })
    if (!ok) return
    setRefunding(true)
    setError(null)
    try {
      await refundPayment({ workspaceId, paymentId: payment.paymentId })
      onRefunded()
    } catch (e) {
      setError(errorMessage(e, "Не удалось вернуть платёж"))
    } finally {
      setRefunding(false)
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">Оплата {amount}</SheetTitle>
        <SheetDescription>Оплачено онлайн, но не зачислено</SheetDescription>
      </SheetHeader>
      {error && <ErrorNote message={error} />}
      {payment.activationError && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {payment.activationError}
        </p>
      )}
      <Facts>
        <Fact label="Ученик">
          {/* A buyer who left the club has no card to open. */}
          {payment.member.isMember ? (
            <Link
              href={`/workspace/${workspaceId}/users/${payment.member.userId}`}
              className="font-medium text-primary hover:underline"
            >
              {payment.member.name}
            </Link>
          ) : (
            payment.member.name
          )}
        </Fact>
        <Fact label="За что">{payment.itemName}</Fact>
        <Fact label="Когда">{formatEntryAt(payment.at, timezone)}</Fact>
        <Fact label="Онлайн">{PROVIDER_LABEL[payment.provider]}</Fact>
      </Facts>
      <p className="text-sm text-muted-foreground">
        {payment.member.isMember
          ? "Выдайте абонемент или место вручную в карточке ученика или верните деньги."
          : "Ученика больше нет в клубе — верните деньги."}
      </p>
      {payment.refundable > 0 && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={refunding}
          onClick={() => void refund()}
        >
          {refunding ? "Возврат…" : "Вернуть деньги"}
        </Button>
      )}
    </>
  )
}
