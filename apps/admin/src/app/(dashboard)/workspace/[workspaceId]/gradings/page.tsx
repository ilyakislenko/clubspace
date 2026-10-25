"use client"

import { useParams } from "next/navigation"

import { GradingsPanel } from "../../../../../features/gradings/GradingsPanel"
import { ReadinessPanel } from "../../../../../features/gradings/ReadinessPanel"
import { isWorkspaceAdmin } from "../../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"

export default function WorkspaceGradingsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const membership = useMyMembership(workspaceId)
  const isAdmin = isWorkspaceAdmin(membership)

  if (!workspaceId) return null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Аттестации</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Кто готов к повышению и проведение аттестаций.
        </p>
      </div>

      <ReadinessPanel workspaceId={workspaceId} isAdmin={isAdmin} />

      {isAdmin && <GradingsPanel workspaceId={workspaceId} />}
    </div>
  )
}
