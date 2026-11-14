"use client"

import { useParams } from "next/navigation"

import { GradingsPanel } from "../../../../../features/gradings/GradingsPanel"
import { ReadinessPanel } from "../../../../../features/gradings/ReadinessPanel"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { beltTabs } from "../sections"

export default function WorkspaceGradingsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  // Direction managers run gradings of their directions' ladders (the server
  // lists only those for them); plain coaches only see readiness.
  const { isSportLead, isDirectionManager } = useDirectionScope(workspaceId)
  const canGrade = isSportLead || isDirectionManager

  if (!workspaceId) return null

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <SectionTabs title="Пояса" tabs={beltTabs} />
        <p className="text-sm text-muted-foreground">
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
