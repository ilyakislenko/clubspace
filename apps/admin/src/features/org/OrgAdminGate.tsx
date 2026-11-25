"use client"

import { useOrg } from "./org-context"

// Team and settings are the federation admins' (the server: ORG_ADMINS); an
// org coach who types the URL sees a notice and the page never mounts.
export function OrgAdminGate({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useOrg()
  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        Раздел доступен администраторам федерации
      </div>
    )
  }
  return <>{children}</>
}
