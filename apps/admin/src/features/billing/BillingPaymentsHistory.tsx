"use client"

import { useEffect, useState } from "react"

import { listBillingPayments, type BillingPayment } from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { PaymentsTable } from "./PaymentsTable"

// «История платежей» on the club's «Тариф» page. Own fetch; `reloadKey`
// changes whenever the page reloads billing after a payment or a change.
export function BillingPaymentsHistory({
  workspaceId,
  reloadKey,
}: {
  workspaceId: string
  reloadKey: number
}) {
  const [payments, setPayments] = useState<BillingPayment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    listBillingPayments({ workspaceId })
      .then((r) => {
        if (!alive) return
        setPayments(r.data)
        setError(null)
      })
      .catch((e) => alive && setError(errorMessage(e, "Не удалось загрузить платежи.")))
    return () => {
      alive = false
    }
  }, [workspaceId, reloadKey])

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">История платежей</h2>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : payments === null ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Платежей картой пока не было.</p>
      ) : (
        <PaymentsTable payments={payments} />
      )}
    </section>
  )
}
