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
  for (const listener of listeners) listener(workspaceId, resources)
}

const ensureSocket = () => {
  if (socket) return
  socket = io(`${environment.apiBaseUrl}/realtime`, {
    transports: ["websocket"],
    // Called on every (re)connect, so a refreshed token is picked up.
    auth: (cb) => cb({ token: getAccessToken() ?? "" }),
  })
  socket.on("invalidate", handleInvalidate)
}

export const subscribeRealtime = (listener: Listener): (() => void) => {
  ensureSocket()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
