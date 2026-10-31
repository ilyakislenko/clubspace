import { useNavigation } from "@react-navigation/native"
import { useCallback } from "react"

import { navigateToTab, type AppNavigation } from "../../app/navigation"
import type { AgendaItem } from "../../shared/api/agenda"
import { useAuth } from "../../shared/auth-context"
import { haptics } from "../../shared/haptics"
import { resolveAgendaOpen, type AgendaTarget } from "./agenda-helpers"

/**
 * Opens an agenda item: switches to its club first when it is another one,
 * then the schedule tab, the events list or the personal session.
 */
export const useOpenAgendaItem = () => {
  const navigation = useNavigation<AppNavigation>()
  const { workspace, workspaces, switchWorkspace } = useAuth()

  return useCallback(
    (item: AgendaItem) => {
      const resolved = resolveAgendaOpen(
        item,
        workspace?.workspaceId,
        workspaces.map((w) => w.workspaceId),
      )
      if (!resolved) return
      const go = (target: AgendaTarget) => {
        if (target.screen === "Schedule") navigateToTab("Schedule")
        else if (target.screen === "PersonalTraining")
          navigation.navigate("PersonalTraining", {
            requestId: target.requestId,
          })
        else navigation.navigate(target.screen)
      }
      if (!resolved.switchTo) {
        go(resolved.target)
        return
      }
      haptics.selection()
      switchWorkspace(resolved.switchTo)
      // After the switch has rendered: the tabs (and which screens exist)
      // follow the new club's sections, so navigating in the same tick could
      // target the old club's navigator.
      setTimeout(() => go(resolved.target), 0)
    },
    [navigation, workspace?.workspaceId, workspaces, switchWorkspace],
  )
}
