"use client"

import { useParams } from "next/navigation"

import { Button } from "@clubspace/ui-kit/ui"

import {
  isDirectionManager,
  isWorkspaceAdmin,
  type CurrentMembership,
} from "../lib/permissions"
import { useMyMembershipState } from "../lib/use-my-membership"

function MembershipGate({
  allows,
  deniedText,
  children,
}: {
  allows: (m: CurrentMembership) => boolean
  deniedText: string
  children: React.ReactNode
}) {
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

  if (!allows(membership)) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        {deniedText}
      </div>
    )
  }

  return <>{children}</>
}

// Wraps sections the server restricts to WORKSPACE_ADMINS. Children mount only
// for admins, so a coach who types the URL doesn't fire requests that 403.
export function AdminOnlyGate({ children }: { children: React.ReactNode }) {
  return (
    <MembershipGate
      allows={isWorkspaceAdmin}
      deniedText="Раздел доступен только администратору клуба"
    >
      {children}
    </MembershipGate>
  )
}

// Sections the server also opens to direction managers (scoped to their
// directions). A plain coach still gets the notice.
export function AdminOrDirectionManagerGate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <MembershipGate
      allows={(m) => isWorkspaceAdmin(m) || isDirectionManager(m)}
      deniedText="Раздел доступен администратору клуба и руководителям направлений"
    >
      {children}
    </MembershipGate>
  )
}
