"use client"

import { useEffect } from "react"
import { useParams } from "next/navigation"

import { setActiveWorkspaceId } from "../../../../shared/workspace/storage"

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

  return <div className="min-h-svh bg-background">{children}</div>
}
