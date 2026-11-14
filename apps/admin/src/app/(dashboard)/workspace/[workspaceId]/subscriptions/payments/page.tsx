"use client"

import { useParams } from "next/navigation"

import { PaymentsList } from "../../../../../../features/payments/PaymentsList"

// «Абонементы → Платежи»: online payments (ЮKassa / Stripe) with refunds.
// The provider keys live in «Настройки → Оплата».
export default function SubscriptionPaymentsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return (
    <div className="max-w-4xl">
      <PaymentsList workspaceId={workspaceId} />
    </div>
  )
}
