"use client"

import { useParams } from "next/navigation"

import { ScheduleCalendar } from "../../../../../features/schedule/calendar/ScheduleCalendar"

export default function SchedulePage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return <ScheduleCalendar workspaceId={workspaceId} />
}
