"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@clubspace/ui-kit/ui"
import { getWorkspaceSettings } from "../../../../shared/api/workspaces"
import { setActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { ThemeSwitcher } from "../../../../shared/theme/theme-switcher"
import { WorkspaceSidebar } from "./workspace-sidebar"

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const [workspaceName, setWorkspaceName] = useState<string>("")

  useEffect(() => {
    if (workspaceId) {
      setActiveWorkspaceId(workspaceId)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    getWorkspaceSettings({ workspaceId })
      .then((settings) => {
        if (!cancelled) setWorkspaceName(settings.name)
      })
      .catch(() => {
        // Header label is cosmetic — keep the generic title on failure.
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

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
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
