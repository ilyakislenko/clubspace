"use client"

import { usePathname } from "next/navigation"

import { ClubAdminGate } from "../../../../../shared/workspace/access-gate"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { subscriptionTabs } from "../sections"

// «Абонементы» (tariffs, the tariff pages, online payments) is the club
// admins'. The title and tabs sit over the two lists, not over a tariff page.
export default function SubscriptionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const onList =
    pathname?.endsWith("/subscriptions") ||
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
