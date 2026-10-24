"use client"

import { useParams } from "next/navigation"

import { Button } from "@clubspace/ui-kit/ui"

import { isWorkspaceAdmin } from "../lib/permissions"
import { useMyMembershipState } from "../lib/use-my-membership"

// Wraps sections the server restricts to WORKSPACE_ADMINS. Children mount only
// for admins, so a coach who types the URL doesn't fire requests that 403.
export function AdminOnlyGate({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceId: string }>()
  const { membership, failed, retry } = useMyMembershipState(
    params?.workspaceId,
  )

  if (!membership) {
    if (!failed) return null
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        <p>Не удалось проверить права доступа.</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={retry}>
          Повторить
        </Button>
      </div>
    )
  }

  if (!isWorkspaceAdmin(membership)) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        Раздел доступен только администратору клуба
      </div>
    )
  }

  return <>{children}</>
}
