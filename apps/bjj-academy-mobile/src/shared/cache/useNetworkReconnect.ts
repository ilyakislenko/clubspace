import { useNetworkState } from "expo-network"
import { useEffect, useRef } from "react"

import { flushOutbox } from "../outbox/outbox"
import { invalidateAll } from "./cache-events"

/**
 * When connectivity is present, keep the app in sync: refetch every open cached
 * screen on a reconnect (the socket doesn't replay missed events), and flush the
 * offline write outbox (queued mutations from while we were offline). Flushing
 * also runs on mount so pending writes from a previous session go out.
 */
export function useNetworkReconnect() {
  const state = useNetworkState()
  const online = Boolean(state.isConnected && state.isInternetReachable)
  const wasOnline = useRef(online)

  useEffect(() => {
    if (online) {
      // Only refetch on an offline → online transition; flush whenever online.
      if (!wasOnline.current) invalidateAll()
      void flushOutbox()
    }
    wasOnline.current = online
  }, [online])
}
