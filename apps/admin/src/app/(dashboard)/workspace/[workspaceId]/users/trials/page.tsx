"use client"

import { useParams } from "next/navigation"

import { LeadsPipeline } from "../../../../../../features/leads/LeadsPipeline"

// «Ученики → Пробные»: trial requests from the club page, the QR poster and
// the phone, worked from «новая» to «купил».
export default function MemberTrialsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return <LeadsPipeline workspaceId={workspaceId} />
}
