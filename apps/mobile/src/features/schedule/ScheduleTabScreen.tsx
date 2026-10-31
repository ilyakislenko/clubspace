import React, { useLayoutEffect } from "react"

import type { TabScreenProps } from "../../app/navigation"
import { scheduleTabContent } from "../../app/tab-routes"
import { useAuth } from "../../shared/auth-context"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { ClubSwitcherButton } from "../clubs/ClubSwitcherButton"
import { MyGroupsScreen } from "../groups/MyGroupsScreen"
import { ClubScheduleScreen } from "./ClubScheduleScreen"

/** The Schedule tab: the club schedule, or the member's groups if it's off. */
export function ScheduleTabScreen({ navigation }: TabScreenProps<"Schedule">) {
  const { workspace } = useAuth()

  // The header names the club whose schedule this is, and switches it.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: ({ children }) => (
        <ClubSwitcherButton variant="header" title={children} />
      ),
    })
  }, [navigation])

  return scheduleTabContent((key) => isFeatureEnabled(workspace, key)) ===
    "ClubSchedule" ? (
    <ClubScheduleScreen />
  ) : (
    <MyGroupsScreen asTab />
  )
}
