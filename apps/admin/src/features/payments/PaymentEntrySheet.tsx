"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  deleteRefund,
  getPaymentJournalEntry,
  type CreateRefundResult,
  type PaymentJournalEntry,
  type PaymentJournalEntryDetail,
  type PaymentJournalUnapplied,
} from "../../shared/api/payment-journal"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmLeave } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  canDeleteRefund,
  entryAmount,
  entryTitle,
  entryWhat,
  formatEntryAt,
  methodLabel,
  refundIdOf,
  subjectRefundable,
} from "./journal-view"
import { PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "./payment-labels"
import { RefundForm } from "./RefundForm"

type Props = {
  workspaceId: string
  timezone: string
  // A journal row (`sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>`, from `?entry=`),
  // or an online payment that never became a sale (the «не зачислено» strip).
  entryId: string | null
  unapplied: PaymentJournalUnapplied | null
  onClose: () => void
  // A refund was made or deleted: the journal reloads.
  onChanged: () => void
}

/**
 * Side panel of one payment or refund: what, when, how, who marked it, the
 * member's card, the payment's refunds; «Вернуть деньги» swaps the body for
 * the refund form.
 */
export function PaymentEntrySheet({
  workspaceId,
  timezone,
  entryId,
  unapplied,
  onClose,
  onChanged,
}: Props) {
  // Closing over a filled refund form asks first.
  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }
  return (
    <Sheet
      open={entryId !== null || unapplied !== null}
      onOpenChange={(open) => !open && void requestClose()}
    >
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        {unapplied ? (
          <UnappliedDetails
            key={unapplied.paymentId}
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
            onClose={onClose}
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

function Notice({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
      {message}
    </p>
  )
}

// «Возврат 1 000 ₽ записан» / «Деньги возвращены на карту: 1 000 ₽».
const refundDoneText = (refund: PaymentJournalEntry): string =>
  refund.method === "ONLINE"
    ? `Деньги возвращены на карту: ${formatAmount(refund.amount, refund.currency)}`
    : `Возврат ${formatAmount(refund.amount, refund.currency)} записан`

// «⋯ → Удалить запись о возврате»: a lone destructive action kept off the row.
function RefundActions({
  refund,
  disabled,
  onDelete,
}: {
  refund: PaymentJournalEntry
  disabled: boolean
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={disabled}
          aria-label={`Действия с возвратом ${entryAmount(refund)}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
          Удалить запись о возврате
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EntryDetails({
  workspaceId,
  timezone,
  entryId,
  onChanged,
  onClose,
}: {
  workspaceId: string
  timezone: string
  entryId: string
  onChanged: () => void
  onClose: () => void
}) {
  const [entry, setEntry] = useState<PaymentJournalEntryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setEntry(await getPaymentJournalEntry({ workspaceId, entryId }))
    } catch (e) {
      setError(errorMessage(e, "Не удалось открыть платёж"))
    }
  }, [workspaceId, entryId])

  useEffect(() => {
    void reload()
  }, [reload])

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
  const subject = { kind: "sale" as const, entry }

  if (refunding) {
    return (
      <>
        <SheetHeader>
          <SheetTitle className="pr-6">Вернуть деньги</SheetTitle>
          <SheetDescription>
            {entry.member.name} · {entryWhat(entry)} · {entryTitle(entry).toLowerCase()}
            {refunded ? `, уже возвращено ${formatAmount(entry.refundedAmount, entry.currency)}` : ""}
          </SheetDescription>
        </SheetHeader>
        <RefundForm
          workspaceId={workspaceId}
          subject={subject}
          onRefunded={(result: CreateRefundResult) => {
            // A full refund of an upcoming ticket cancelled the place too.
            const cancelled =
              entry.fullRefundCancelsRegistration && result.sale?.refundable === 0
            if (result.sale) setEntry(result.sale)
            setRefunding(false)
            setError(null)
            setNotice(
              cancelled
                ? `${refundDoneText(result.refund)}. Запись на событие отменена`
                : refundDoneText(result.refund),
            )
            onChanged()
          }}
          onCancel={() => setRefunding(false)}
          onStale={() => void reload()}
        />
      </>
    )
  }

  // Deleting an offline refund's record: the sale's panel reloads; the
  // refund's own panel closes (the row is gone).
  const removeRefund = async (refund: PaymentJournalEntry) => {
    const ok = await confirmDialog({
      title: `Удалить запись о возврате ${formatAmount(refund.amount, refund.currency)}?`,
      description: "Сумма снова войдёт в выручку.",
      confirmLabel: "Удалить запись",
      destructive: true,
    })
    if (!ok) return
    setDeletingId(refund.id)
    setError(null)
    setNotice(null)
    try {
      await deleteRefund({ workspaceId, refundId: refundIdOf(refund.id) })
      onChanged()
      if (refund.id === entry.id) {
        onClose()
        return
      }
      await reload()
      setNotice("Запись о возврате удалена")
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить запись о возврате"))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <SheetHeader>
        <div className="flex items-start gap-2 pr-6">
          <SheetTitle className="flex-1">{entryTitle(entry)}</SheetTitle>
          {canDeleteRefund(entry) && (
            <RefundActions
              refund={entry}
              disabled={deletingId !== null}
              onDelete={() => void removeRefund(entry)}
            />
          )}
        </div>
        <SheetDescription>{entryWhat(entry)}</SheetDescription>
      </SheetHeader>
      {error && <ErrorNote message={error} />}
      {notice && <Notice message={notice} />}
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
        {entry.kind === "refund" && <Fact label="За что">{entry.itemName}</Fact>}
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
              <li key={r.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex justify-between gap-3">
                    <span>{formatEntryAt(r.at, timezone)}</span>
                    <span className="font-medium tabular-nums text-destructive">
                      {entryAmount(r)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[methodLabel(r.method), r.markedBy?.name, r.reason].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {canDeleteRefund(r) ? (
                  <RefundActions
                    refund={r}
                    disabled={deletingId !== null}
                    onDelete={() => void removeRefund(r)}
                  />
                ) : (
                  // Keeps the amounts in one column beside the «⋯» of others.
                  <span className="size-7 shrink-0" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {subjectRefundable(subject) > 0 && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={deletingId !== null}
          onClick={() => {
            setNotice(null)
            setRefunding(true)
          }}
        >
          Вернуть деньги
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
  const amount = formatAmount(payment.amount, payment.currency)
  const subject = { kind: "unapplied" as const, payment }

  if (refunding) {
    return (
      <>
        <SheetHeader>
          <SheetTitle className="pr-6">Вернуть деньги</SheetTitle>
          <SheetDescription>
            {payment.member.name} · {payment.itemName} · оплата {amount}
          </SheetDescription>
        </SheetHeader>
        <RefundForm
          workspaceId={workspaceId}
          subject={subject}
          onRefunded={onRefunded}
          onCancel={() => setRefunding(false)}
          // Nothing to reload here: the strip's item comes with the journal.
          onStale={() => undefined}
        />
      </>
    )
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">Оплата {amount}</SheetTitle>
        <SheetDescription>Оплачено онлайн, но не зачислено</SheetDescription>
      </SheetHeader>
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
      {subjectRefundable(subject) > 0 && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setRefunding(true)}
        >
          Вернуть деньги
        </Button>
      )}
    </>
  )
}
