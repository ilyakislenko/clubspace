import { useEffect } from "react"
import { io, type Socket } from "socket.io-client"

import { getAccessToken } from "../api/client"
import {
  applyListDelta,
  invalidateResource,
  type DeltaItem,
  type DeltaOp,
} from "../cache/cache-events"
import { environment } from "../env"

let socket: Socket | null = null

type InvalidatePayload = { workspaceId?: unknown; resources?: unknown }

// Server pushes { workspaceId, resources: string[] }; turn each resource into a
// cache invalidation so the matching open screen refetches.
const handleInvalidate = (payload: InvalidatePayload) => {
  const workspaceId =
    typeof payload?.workspaceId === "string" ? payload.workspaceId : null
  if (!workspaceId) return
  const resources = Array.isArray(payload?.resources) ? payload.resources : []
  for (const resource of resources) {
    if (typeof resource === "string") invalidateResource(resource, workspaceId)
  }
}

// Server pushes { workspaceId, list, op, item } — patch the cached list in
// place so the open screen updates instantly without a refetch.
const handleDelta = (payload: {
  workspaceId?: unknown
  list?: unknown
  op?: unknown
  item?: unknown
}) => {
  const workspaceId =
    typeof payload?.workspaceId === "string" ? payload.workspaceId : null
  const list = typeof payload?.list === "string" ? payload.list : null
  const op = payload?.op
  const item = payload?.item
  if (!workspaceId || !list) return
  if (op !== "create" && op !== "update" && op !== "delete") return
  if (typeof item !== "object" || item === null) return
  const record = item as Record<string, unknown>
  if (typeof record.id !== "string") return
  applyListDelta(`${list}:${workspaceId}`, op as DeltaOp, record as DeltaItem)
}

const connectRealtime = () => {
  if (socket) return
  socket = io(`${environment.apiBaseUrl}/realtime`, {
    // RN has no reliable long-polling fallback; go straight to WebSocket.
    transports: ["websocket"],
    // Called on every (re)connect, so a token refresh is picked up without
    // tearing the socket down.
    auth: (cb) => cb({ token: getAccessToken() ?? "" }),
  })
  socket.on("invalidate", handleInvalidate)
  socket.on("delta", handleDelta)
}

const disconnectRealtime = () => {
  if (!socket) return
  socket.off("invalidate", handleInvalidate)
  socket.off("delta", handleDelta)
  socket.disconnect()
  socket = null
}

/**
 * Keeps a realtime connection open while signed in. socket.io handles
 * reconnection/heartbeats; on the server side the connection joins a room per
 * workspace and receives `invalidate` events for live cache refresh.
 */
export function useRealtime(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    connectRealtime()
    return () => disconnectRealtime()
  }, [enabled])
}
