"use client"

import { useParams } from "next/navigation"
import { useEffect } from "react"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@bjj-academy/ui-kit/ui"
import { setActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { WorkspaceSidebar } from "./workspace-sidebar"

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ workspaceId: string }>()

  useEffect(() => {
    if (params?.workspaceId) {
      setActiveWorkspaceId(params.workspaceId)
    }
  }, [params?.workspaceId])

  return (
    <SidebarProvider>
      <WorkspaceSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <div className="text-sm font-medium text-muted-foreground">
            Workspace
          </div>
        </header>
        <div className="flex-1 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
