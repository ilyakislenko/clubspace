"use client"

import { useParams } from "next/navigation"

export default function WorkspacePage() {
  const params = useParams<{ workspaceId: string }>()

  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Workspace: {params.workspaceId}
    </div>
  )
}
