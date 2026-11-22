"use client"

import { usePathname } from "next/navigation"

import { ClubAdminGate } from "../../../../../shared/workspace/access-gate"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { subscriptionTabs } from "../sections"

// «Абонементы» (tariffs, the tariff pages, discounts, the payments journal)
// is the club admins'. The title and tabs sit over the three lists, not over
// a tariff page.
export default function SubscriptionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const onList =
    pathname?.endsWith("/subscriptions") ||
    pathname?.endsWith("/subscriptions/discounts") ||
    pathname?.endsWith("/subscriptions/payments")
  return (
    <ClubAdminGate>
      {onList ? (
        <div className="space-y-6">
          <SectionTabs title="Абонементы" tabs={subscriptionTabs} />
          {children}
        </div>
      ) : (
        children
      )}
    </ClubAdminGate>
  )
}
