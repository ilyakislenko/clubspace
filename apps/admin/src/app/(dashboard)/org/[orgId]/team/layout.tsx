"use client"

import { OrgAdminGate } from "../../../../../features/org/OrgAdminGate"

export default function OrgTeamLayout({ children }: { children: React.ReactNode }) {
  return <OrgAdminGate>{children}</OrgAdminGate>
}
