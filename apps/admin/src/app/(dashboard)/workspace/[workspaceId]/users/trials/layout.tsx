"use client"

import { SportLeadGate } from "../../../../../../shared/workspace/access-gate"

// Strangers' phones and the funnel they feed: owner, admins, head coach.
export default function SportLeadLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SportLeadGate>{children}</SportLeadGate>
}
