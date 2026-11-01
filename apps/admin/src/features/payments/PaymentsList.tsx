"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  listPayments,
  refundPayment,
  type PaymentRow,
  type PaymentStatus,
} from "../../shared/api/payments"
import { errorMessage } from "../../shared/lib/error-message"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  PAYMENT_STATUS_CLASS,
  PAYMENT_STATUS_LABEL,
  formatDateTime,
} from "./payment-labels"

const ALL = "all"
const PER_PAGE = 20

const REFUND_HINT =
  "Абонемент автоматически не отменяется — решите на карточке участника, отменить ли его."

export function PaymentsList({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<PaymentStatus | typeof ALL>(ALL)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refundingId, setRefundingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listPayments({
        workspaceId,
        status: status === ALL ? undefined : status,
        page,
        perPage: PER_PAGE,
      })
      setRows(res.data)
      setTotal(res.total)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить платежи"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))

  const onRefund = async (p: PaymentRow) => {
    if (
      !window.confirm(
        `Вернуть ${formatAmount(p.amount, p.currency)} участнику ${p.member.name}?\n\n${REFUND_HINT}`,
      )
    )
      return
    setRefundingId(p.id)
    setNotice(null)
    try {
      const updated = await refundPayment({ workspaceId, paymentId: p.id })
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setError(null)
      setNotice(`Деньги возвращены: ${p.member.name}. ${REFUND_HINT}`)
    } catch (e) {
      setError(errorMessage(e, "Не удалось вернуть платёж"))
    } finally {
      setRefundingId(null)
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-medium">Платежи</div>
        <div className="w-48">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as PaymentStatus | typeof ALL)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все статусы</SelectItem>
              {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map(
                (s) => (
                  <SelectItem key={s} value={s}>
                    {PAYMENT_STATUS_LABEL[s]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Платежей пока нет.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-normal">Дата</th>
                <th className="py-2 pr-3 font-normal">Участник</th>
                <th className="py-2 pr-3 font-normal">Тариф</th>
                <th className="py-2 pr-3 text-right font-normal">Сумма</th>
                <th className="py-2 pr-3 font-normal">Статус</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                    {formatDateTime(p.paidAt ?? p.createdAt)}
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/workspace/${workspaceId}/users/${p.member.userId}`}
                      className="font-medium hover:underline"
                    >
                      {p.member.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.member.email}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {p.planName}
                    {p.status === "SUCCEEDED" && p.activationError && (
                      <div className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
                        Оплачен, но абонемент не оформлен: {p.activationError} —
                        оформите вручную или верните деньги
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                    {formatAmount(p.amount, p.currency)}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PAYMENT_STATUS_CLASS[p.status]}`}
                    >
                      {PAYMENT_STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {p.status === "SUCCEEDED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={refundingId !== null}
                        onClick={() => void onRefund(p)}
                      >
                        {refundingId === p.id ? "Возврат…" : "Вернуть"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PER_PAGE && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Страница {page} из {pageCount} · всего {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => setPage((n) => n - 1)}
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page >= pageCount}
              onClick={() => setPage((n) => n + 1)}
            >
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
