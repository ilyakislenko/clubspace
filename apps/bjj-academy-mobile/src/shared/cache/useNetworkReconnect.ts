import { useNetworkState } from "expo-network"
import { useEffect, useRef } from "react"

import { invalidateAll } from "./cache-events"

/**
 * Refetch every open cached screen when connectivity returns after being
 * offline. Complements the realtime socket (which doesn't replay events missed
 * while disconnected) and the focus-refetch (which only fires on navigation).
 */
export function useNetworkReconnect() {
  const state = useNetworkState()
  const online = Boolean(state.isConnected && state.isInternetReachable)
  const wasOnline = useRef(online)

  useEffect(() => {
    if (online && !wasOnline.current) invalidateAll()
    wasOnline.current = online
  }, [online])
}
