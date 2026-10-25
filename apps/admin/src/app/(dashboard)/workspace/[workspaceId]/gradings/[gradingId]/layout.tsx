"use client"

import { AdminOnlyGate } from "../../../../../../shared/workspace/admin-only-gate"

export default function AdminOnlyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminOnlyGate>{children}</AdminOnlyGate>
}
