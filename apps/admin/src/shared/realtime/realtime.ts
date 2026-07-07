"use client"

import { io, type Socket } from "socket.io-client"

import { getAccessToken } from "../api/client"
import { environment } from "../../environments/environment"

// Admin-side realtime: a single socket.io connection to the same /realtime
// gateway the mobile app uses. The server pushes { workspaceId, resources }
// invalidations to the workspaces the signed-in user can access; pages register
// a listener (see useWorkspaceRealtime) and refetch when a resource they show
// is invalidated.

type Listener = (workspaceId: string, resources: string[]) => void

let socket: Socket | null = null
const listeners = new Set<Listener>()

const notify = (workspaceId: string, resources: string[]) => {
  for (const listener of listeners) listener(workspaceId, resources)
}

const handleInvalidate = (payload: {
  workspaceId?: unknown
  resources?: unknown
}) => {
  const workspaceId =
    typeof payload?.workspaceId === "string" ? payload.workspaceId : null
  if (!workspaceId) return
  const resources = Array.isArray(payload?.resources)
    ? payload.resources.filter((r): r is string => typeof r === "string")
    : []
  notify(workspaceId, resources)
}

// The admin has no client cache to patch, so a list delta is just a signal to
// refetch that list — map it to an invalidation of the delta's `list`.
const handleDelta = (payload: { workspaceId?: unknown; list?: unknown }) => {
  const workspaceId =
    typeof payload?.workspaceId === "string" ? payload.workspaceId : null
  const list = typeof payload?.list === "string" ? payload.list : null
  if (!workspaceId || !list) return
  notify(workspaceId, [list])
}

const ensureSocket = () => {
  if (socket) return
  socket = io(`${environment.apiBaseUrl}/realtime`, {
    transports: ["websocket"],
    // Called on every (re)connect, so a refreshed token is picked up.
    auth: (cb) => cb({ token: getAccessToken() ?? "" }),
  })
  socket.on("invalidate", handleInvalidate)
  socket.on("delta", handleDelta)
}

export const subscribeRealtime = (listener: Listener): (() => void) => {
  ensureSocket()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
