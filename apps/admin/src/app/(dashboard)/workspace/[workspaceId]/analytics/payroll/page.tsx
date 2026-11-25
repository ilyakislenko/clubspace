"use client"

import { useParams } from "next/navigation"

import { PayrollMonthView } from "../../../../../../features/payroll/PayrollMonthView"

export default function PayrollPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return <PayrollMonthView workspaceId={workspaceId} />
}
