import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useRef, useState } from "react"

import { listMyInvitations, type Invitation } from "../../shared/api/invitations"
import { subscribeInvalidation } from "../../shared/cache/cache-events"

/**
 * The member's pending club invitations. Refetched whenever the screen gains
 * focus (tabs stay mounted) and when the server says they changed — it emits a
 * user-scoped `invitations` invalidation, which the realtime bridge maps to
 * the "invitations:me" key.
 */
export function useMyInvitations() {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)

  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const reload = useCallback(async () => {
    try {
      const list = await listMyInvitations()
      if (!mounted.current) return
      setInvitations(list)
      setFailed(false)
    } catch {
      if (mounted.current) setFailed(true)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  useEffect(
    () => subscribeInvalidation("invitations:me", () => void reload()),
    [reload],
  )

  return { invitations, failed, reload }
}
