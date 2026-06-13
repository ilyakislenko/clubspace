"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@bjj-academy/ui-kit/ui"
import { getWorkspaceSettings } from "../../../../shared/api/workspaces"
import { setActiveWorkspaceId } from "../../../../shared/workspace/storage"
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
    <SidebarProvider>
      <WorkspaceSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <div className="text-sm font-medium">
            {workspaceName || "Workspace"}
          </div>
        </header>
        <div className="flex-1 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
