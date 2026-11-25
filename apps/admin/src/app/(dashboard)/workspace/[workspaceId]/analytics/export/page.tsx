"use client"

import { useParams } from "next/navigation"

import { DataExportCard } from "../../../../../../features/exports/DataExportCard"
import { PayrollExportCard } from "../../../../../../features/payroll/PayrollExportCard"

export default function ReportsExportPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return (
    <div className="max-w-3xl space-y-4">
      <DataExportCard workspaceId={workspaceId} />
      <PayrollExportCard workspaceId={workspaceId} />
    </div>
  )
}
