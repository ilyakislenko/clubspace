"use client"

import { useParams } from "next/navigation"

import { isWorkspaceAdmin } from "../lib/permissions"
import { useMyMembership } from "../lib/use-my-membership"

// Wraps sections the server restricts to WORKSPACE_ADMINS. Children mount only
// for admins, so a coach who types the URL doesn't fire requests that 403.
export function AdminOnlyGate({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceId: string }>()
  const membership = useMyMembership(params?.workspaceId)

  if (!membership) return null

  if (!isWorkspaceAdmin(membership)) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        Раздел доступен только администратору клуба
      </div>
    )
  }

  return <>{children}</>
}
