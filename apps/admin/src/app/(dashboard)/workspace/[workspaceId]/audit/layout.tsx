"use client"

import { ClubAdminGate } from "../../../../../shared/workspace/access-gate"

export default function ClubAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClubAdminGate>{children}</ClubAdminGate>
}
