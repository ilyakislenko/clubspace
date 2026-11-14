"use client"

import { useParams } from "next/navigation"

import { DataExportCard } from "../../../../../../features/exports/DataExportCard"

export default function ReportsExportPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return (
    <div className="max-w-3xl">
      <DataExportCard workspaceId={workspaceId} />
    </div>
  )
}
