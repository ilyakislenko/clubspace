"use client"

import { OrgAdminGate } from "../../../../../features/org/OrgAdminGate"

export default function OrgSettingsLayout({ children }: { children: React.ReactNode }) {
  return <OrgAdminGate>{children}</OrgAdminGate>
}
