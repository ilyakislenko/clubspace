"use client"

import { useParams } from "next/navigation"

import { GradingsPanel } from "../../../../../features/gradings/GradingsPanel"
import { ReadinessPanel } from "../../../../../features/gradings/ReadinessPanel"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"

export default function WorkspaceGradingsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  // Direction managers run gradings of their directions' ladders (the server
  // lists only those for them); plain coaches only see readiness.
  const { isAdmin, isDirectionManager } = useDirectionScope(workspaceId)
  const canGrade = isAdmin || isDirectionManager

  if (!workspaceId) return null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Аттестации</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Кто готов к повышению и проведение аттестаций.
        </p>
      </div>

      <ReadinessPanel
        workspaceId={workspaceId}
        canGrade={canGrade}
        ownLaddersOnly={isDirectionManager}
      />

      {canGrade && <GradingsPanel workspaceId={workspaceId} />}
    </div>
  )
}
