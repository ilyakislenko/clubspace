"use client"

import { LeadGate } from "../../../../../shared/workspace/access-gate"

export default function LeadLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <LeadGate>{children}</LeadGate>
}
