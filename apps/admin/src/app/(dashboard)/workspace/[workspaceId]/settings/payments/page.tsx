"use client"

import Link from "next/link"
import { useParams } from "next/navigation"

import { PaymentSettingsCard } from "../../../../../../features/payments/PaymentSettingsCard"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"

// «Настройки → Оплата»: the club's ЮKassa/Stripe connection. The payments
// themselves are listed in «Абонементы → Платежи».
export default function SettingsPaymentsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return (
    <>
      <SettingsSectionHeader
        title="Оплата"
        description={
          <>
            Подключите ЮKassa или Stripe — участники смогут сами оплачивать
            абонементы и билеты на события в приложении: абонемент оформится, а
            билет отметится оплаченным автоматически после оплаты. Поступившие
            платежи и возвраты — в разделе{" "}
            <Link
              href={`/workspace/${workspaceId}/subscriptions/payments`}
              className="underline underline-offset-2"
            >
              «Абонементы → Платежи»
            </Link>
            .
          </>
        }
      />
      <PaymentSettingsCard workspaceId={workspaceId} />
    </>
  )
}
