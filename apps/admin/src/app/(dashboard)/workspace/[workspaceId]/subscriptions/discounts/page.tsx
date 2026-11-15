"use client"

import { useParams } from "next/navigation"

import { DiscountList } from "../../../../../../features/discounts/DiscountList"

// «Абонементы → Скидки»: the club's discounts and promo codes, and who gave
// how much off the list price.
export default function SubscriptionDiscountsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return (
    <div className="max-w-5xl">
      <DiscountList workspaceId={workspaceId} />
    </div>
  )
}
