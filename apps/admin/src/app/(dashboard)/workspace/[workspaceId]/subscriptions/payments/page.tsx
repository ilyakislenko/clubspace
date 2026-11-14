"use client"

import { useParams } from "next/navigation"

import { PaymentJournal } from "../../../../../../features/payments/PaymentJournal"

// «Абонементы → Платежи»: the payments journal — every abonement and event
// payment, any method. The provider keys live in «Настройки → Оплата».
export default function SubscriptionPaymentsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return (
    <div className="max-w-5xl">
      <PaymentJournal workspaceId={workspaceId} />
    </div>
  )
}
