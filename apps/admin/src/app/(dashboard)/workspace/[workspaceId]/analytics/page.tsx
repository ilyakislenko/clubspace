"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"

import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { useWorkspaceFeatures } from "../../../../../shared/lib/use-workspace-features"
import { LeadGate } from "../../../../../shared/workspace/access-gate"
import { visibleTabs } from "../../../../../shared/workspace/section-tabs"
import { reportTabs } from "../sections"

// The old «Аналитика» hub: forwards to the first report the role may open
// (the sidebar's «Отчёты» links there directly). A plain coach has none and
// gets the access notice from the gate.
export default function ReportsRedirectPage() {
  return (
    <LeadGate>
      <ReportsRedirect />
    </LeadGate>
  )
}

function ReportsRedirect() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const vocabulary = useVocabulary()
  const workspaceId = params?.workspaceId
  const membership = useMyMembership(workspaceId)
  const features = useWorkspaceFeatures(workspaceId)
  const firstPath = visibleTabs(reportTabs(vocabulary), membership, features)[0]?.path

  useEffect(() => {
    if (workspaceId && firstPath) {
      router.replace(`/workspace/${workspaceId}/${firstPath}`)
    }
  }, [router, workspaceId, firstPath])

  return null
}
