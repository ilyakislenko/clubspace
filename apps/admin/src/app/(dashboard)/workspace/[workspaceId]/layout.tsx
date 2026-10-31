"use client"

import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@clubspace/ui-kit/ui"
import { getWorkspaceSettings } from "../../../../shared/api/workspaces"
import { isWorkspaceAdmin } from "../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../shared/lib/use-my-membership"
import { setActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { ThemeSwitcher } from "../../../../shared/theme/theme-switcher"
import { BillingBanner } from "../../../../features/billing/BillingBanner"
import {
  readSuspended,
  type SuspendedInfo,
} from "../../../../features/billing/billing-view"
import { WorkspaceSidebar } from "./workspace-sidebar"

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ workspaceId: string }>()
  const pathname = usePathname()
  const workspaceId = params?.workspaceId
  const [workspaceName, setWorkspaceName] = useState<string>("")
  // Set when the API answers WORKSPACE_SUSPENDED: the club is closed, and
  // only its billing page stays open (for admins).
  const [suspended, setSuspended] = useState<SuspendedInfo | null>(null)
  const canAdmin = isWorkspaceAdmin(useMyMembership(workspaceId))

  useEffect(() => {
    if (workspaceId) {
      setActiveWorkspaceId(workspaceId)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setSuspended(null)
    getWorkspaceSettings({ workspaceId })
      .then((settings) => {
        if (!cancelled) setWorkspaceName(settings.name)
      })
      .catch((error) => {
        // Header label is cosmetic — keep the generic title on failure. A
        // suspended club is the one failure that changes the whole shell.
        const info = readSuspended(error)
        if (!cancelled && info) {
          setSuspended(info)
          setWorkspaceName(info.workspaceName)
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const onBillingPage = Boolean(pathname?.endsWith("/billing"))

  return (
    // The shell is exactly one viewport tall and the CONTENT is the scroll
    // container — not the document. With document-level scrolling the header
    // scrolled away, and on a long page (settings is ~1800px) the bottom of the
    // content sat past the window edge with no visual cue that the page, rather
    // than the panel, was the thing to scroll. Now the sidebar and the club
    // title stay put and only the middle moves.
    <SidebarProvider className="h-svh overflow-hidden">
      <WorkspaceSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <div className="text-sm font-medium">
            {workspaceName || "Клуб"}
          </div>
          <div className="ml-auto">
            <ThemeSwitcher />
          </div>
        </header>
        {workspaceId && !suspended && <BillingBanner workspaceId={workspaceId} />}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {suspended && !(onBillingPage && canAdmin) ? (
            <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm">
              <div className="text-base font-medium text-destructive">
                {suspended.reason === "SUSPENDED"
                  ? "Клуб приостановлен"
                  : "Клуб отключён"}
              </div>
              <p>{suspended.message}</p>
              {canAdmin && suspended.reason === "SUSPENDED" && workspaceId && (
                <Link
                  href={`/workspace/${workspaceId}/billing`}
                  className="inline-block font-medium underline underline-offset-4"
                >
                  Открыть «Тариф и лимиты»
                </Link>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
