"use client"

import { AdminOrDirectionManagerGate } from "../../../../../../shared/workspace/admin-only-gate"

export default function AdminOrDirectionManagerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminOrDirectionManagerGate>{children}</AdminOrDirectionManagerGate>
}
