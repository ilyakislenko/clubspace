"use client"

import { useEffect } from "react"
import { useParams } from "next/navigation"

import { setActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@bjj-academy/ui-kit/ui"
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
        <header className="flex h-14 items-center gap-2 border-b px-4">
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
