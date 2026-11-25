"use client"

import { useParams } from "next/navigation"
import { useLayoutEffect, useMemo, useState } from "react"

import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@clubspace/ui-kit/ui"

import { OrgGate } from "../../../../features/org/OrgGate"
import { useOrg } from "../../../../features/org/org-context"
import { defaultSidebarOpen } from "../../../../shared/lib/sidebar-default"
import { VocabularyProvider } from "../../../../shared/lib/vocabulary"
import { ThemeSwitcher } from "../../../../shared/theme/theme-switcher"
import { OrgSidebar } from "./org-sidebar"

// `/org/<id>`: the federation console, a third area beside `/workspace/<id>`
// and `/platform` (docs/design/2026-11-26-federation-hub-mvp.md §4.1). Org
// staff are not club staff, so it has its own sidebar; the shell is the
// club's (one viewport tall, only the content scrolls).
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ orgId: string }>()
  const orgId = params?.orgId
  if (!orgId) return null
  return (
    <OrgGate key={orgId} orgId={orgId}>
      <OrgShell>{children}</OrgShell>
    </OrgGate>
  )
}

function OrgShell({ children }: { children: React.ReactNode }) {
  const { org } = useOrg()
  // The federation's discipline picks the words, as a club's does.
  const vocabulary = useMemo(() => vocabularyForWorkspaceType(org.type), [org.type])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useLayoutEffect(() => {
    setSidebarOpen(defaultSidebarOpen(document.cookie, window.innerWidth))
  }, [])

  return (
    <VocabularyProvider value={vocabulary}>
      <SidebarProvider className="h-svh overflow-hidden" open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <OrgSidebar />
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger />
            <div className="text-sm font-medium">{org.name}</div>
            <div className="ml-auto">
              <ThemeSwitcher />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </VocabularyProvider>
  )
}
