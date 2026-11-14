"use client"

import { useParams } from "next/navigation"

import { Button } from "@clubspace/ui-kit/ui"

import { hasAccess, type Access } from "../lib/permissions"
import { useMyMembershipState } from "../lib/use-my-membership"
import { useVocabulary } from "../lib/vocabulary"

// Children mount only once the membership passes, so a role that types the
// URL sees a notice instead of firing requests that 403.
function AccessGate({
  access,
  deniedText,
  children,
}: {
  access: Exclude<Access, "staff">
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

  if (!hasAccess(membership, access)) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        {deniedText}
      </div>
    )
  }

  return <>{children}</>
}

// Money & system sections the server restricts to CLUB_ADMINS.
export function ClubAdminGate({ children }: { children: React.ReactNode }) {
  return (
    <AccessGate
      access="clubAdmin"
      deniedText="Раздел доступен владельцу и администраторам клуба"
    >
      {children}
    </AccessGate>
  )
}

// Club-wide sport sections the server restricts to SPORT_LEADS.
export function SportLeadGate({ children }: { children: React.ReactNode }) {
  const vocabulary = useVocabulary()
  return (
    <AccessGate
      access="sportLead"
      deniedText={`Раздел доступен владельцу, администраторам и ${vocabulary.headCoach.dat}`}
    >
      {children}
    </AccessGate>
  )
}

// Sport sections the server also opens to direction managers (scoped to their
// directions). A plain coach still gets the notice.
export function LeadGate({ children }: { children: React.ReactNode }) {
  const vocabulary = useVocabulary()
  return (
    <AccessGate
      access="lead"
      deniedText={`Раздел доступен владельцу, администраторам, ${vocabulary.headCoach.dat} и руководителям направлений`}
    >
      {children}
    </AccessGate>
  )
}
