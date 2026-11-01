import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useRef, useState } from "react"

import { listMyInvitations, type Invitation } from "../../shared/api/invitations"
import { useAuth } from "../../shared/auth-context"
import { subscribeInvalidation } from "../../shared/cache/cache-events"

/**
 * The member's pending club invitations. Refetched whenever the screen gains
 * focus (tabs stay mounted) and when the server says they changed — it emits a
 * user-scoped `invitations` invalidation, which the realtime bridge maps to
 * the "invitations:me" key. Invitations are the signed-in guardian's: in a
 * child's profile the list is empty (accepting one would join the guardian).
 */
export function useMyInvitations() {
  const { actingAs } = useAuth()
  const asChild = actingAs !== null
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
    if (asChild) {
      setInvitations([])
      setFailed(false)
      return
    }
    try {
      const list = await listMyInvitations()
      if (!mounted.current) return
      setInvitations(list)
      setFailed(false)
    } catch {
      if (mounted.current) setFailed(true)
    }
  }, [asChild])

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
