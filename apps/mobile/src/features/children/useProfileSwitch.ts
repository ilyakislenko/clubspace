import { useEffect, useRef, useState } from "react"

import { useAuth } from "../../shared/auth-context"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import {
  dropAfterSwitch,
  navigateTo,
  openAfterSwitch,
  type AfterSwitchRoute,
} from "./after-switch"

/**
 * Switches between the guardian («Я») and a confirmed child, optionally
 * opening a screen in the new profile (e.g. the join screen for a child).
 * `busy` is the profile being switched to ("self" for the guardian).
 */
export function useProfileSwitch() {
  const { actingAs, switchProfile } = useAuth()
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const switchTo = async (
    dependentId: string | null,
    then?: AfterSwitchRoute,
  ): Promise<boolean> => {
    if (busy) return false
    if ((actingAs?.id ?? null) === dependentId) {
      if (then) navigateTo(then)
      return true
    }
    setBusy(dependentId ?? "self")
    if (then) openAfterSwitch(dependentId, then)
    try {
      await switchProfile(dependentId)
      return true
    } catch (error) {
      dropAfterSwitch()
      showToast(errorMessage(error, "Не удалось переключить профиль"), "error")
      return false
    } finally {
      // A successful switch usually unmounts the caller with its stack.
      if (mounted.current) setBusy(null)
    }
  }

  return { busy, switchTo }
}
