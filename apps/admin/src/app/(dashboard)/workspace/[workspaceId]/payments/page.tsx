"use client"

import { useParams } from "next/navigation"

import { PaymentSettingsCard } from "../../../../../features/payments/PaymentSettingsCard"
import { PaymentsList } from "../../../../../features/payments/PaymentsList"

export default function WorkspacePaymentsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  if (!workspaceId) return null

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Онлайн-оплата</h1>
        <p className="text-sm text-muted-foreground">
          Подключите ЮKassa или Stripe — участники смогут сами оплачивать
          абонементы и билеты на события в приложении: абонемент оформится, а
          билет отметится оплаченным автоматически после оплаты.
        </p>
      </div>
      <PaymentSettingsCard workspaceId={workspaceId} />
      <PaymentsList workspaceId={workspaceId} />
    </div>
  )
}
