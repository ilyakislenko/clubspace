import React from "react"

import { scheduleTabContent } from "../../app/tab-routes"
import { useAuth } from "../../shared/auth-context"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { MyGroupsScreen } from "../groups/MyGroupsScreen"
import { ClubScheduleScreen } from "./ClubScheduleScreen"

/** The Schedule tab: the club schedule, or the member's groups if it's off. */
export function ScheduleTabScreen() {
  const { workspace } = useAuth()
  return scheduleTabContent((key) => isFeatureEnabled(workspace, key)) ===
    "ClubSchedule" ? (
    <ClubScheduleScreen />
  ) : (
    <MyGroupsScreen />
  )
}
