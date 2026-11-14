"use client"

import { useParams } from "next/navigation"

import { SettingsNav } from "../../../../../features/settings/SettingsNav"
import { ClubAdminGate } from "../../../../../shared/workspace/access-gate"

// «Настройки»: one page per section with a shared section menu. Club admins
// only — the server gates every endpoint behind these pages with CLUB_ADMINS.
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  return (
    <ClubAdminGate>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {workspaceId && (
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <SettingsNav workspaceId={workspaceId} />
            </aside>
          )}
          <div className="min-w-0 max-w-4xl space-y-6">{children}</div>
        </div>
      </div>
    </ClubAdminGate>
  )
}
