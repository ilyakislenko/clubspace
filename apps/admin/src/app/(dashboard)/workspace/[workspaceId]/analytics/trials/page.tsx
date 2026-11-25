"use client"

import { useParams } from "next/navigation"

import { LeadConversionReport } from "../../../../../../features/leads/LeadConversionReport"

export default function TrialsReportPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return <LeadConversionReport workspaceId={workspaceId} />
}
