"use client"

import { ClubAdminGate } from "../../../../../../shared/workspace/access-gate"

// Data exports are money & system: club admins only (server: CLUB_ADMINS).
export default function ClubAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClubAdminGate>{children}</ClubAdminGate>
}
