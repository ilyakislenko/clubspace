"use client"

import { ClubAdminGate } from "../../../../../shared/workspace/access-gate"

// Tariff management (and the tariff pages below) is the club admins'.
export default function ClubAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClubAdminGate>{children}</ClubAdminGate>
}
