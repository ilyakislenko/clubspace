"use client"

import { SportLeadGate } from "../../../../../../shared/workspace/access-gate"

export default function SportLeadLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SportLeadGate>{children}</SportLeadGate>
}
