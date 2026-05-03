import * as SecureStore from "expo-secure-store"
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  clearAuthTokens,
  getAccessToken,
  setOnUnauthorized,
} from "./api/client"
import {
  fetchMyWorkspaces,
  type WorkspaceSummary,
} from "./api/workspaces"
import { hydrateMobileTokenStore } from "./api/token-store"
import {
  registerPushToken,
  unregisterPushToken,
} from "../features/notifications/push-registration"

type AuthContextValue = {
  ready: boolean
  authed: boolean
  workspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  switchWorkspace: (workspaceId: string) => void
  /** Re-fetch current workspace after a successful sign-in. */
  refresh: () => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const ACTIVE_WORKSPACE_KEY = "bjj.activeWorkspaceId"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)

  const persistActive = useCallback((id: string | null) => {
    if (id) {
      void SecureStore.setItemAsync(ACTIVE_WORKSPACE_KEY, id).catch(() => {
        /* noop */
      })
    } else {
      void SecureStore.deleteItemAsync(ACTIVE_WORKSPACE_KEY).catch(() => {
        /* noop */
      })
    }
  }, [])

  const signOut = useCallback(() => {
    void unregisterPushToken()
    clearAuthTokens()
    persistActive(null)
    setAuthed(false)
    setWorkspaces([])
    setWorkspace(null)
  }, [persistActive])

  const refresh = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      setAuthed(false)
      setWorkspaces([])
      setWorkspace(null)
      return
    }
    try {
      const response = await fetchMyWorkspaces()
      const list = response.data
      setWorkspaces(list)
      const stored = await SecureStore.getItemAsync(ACTIVE_WORKSPACE_KEY).catch(
        () => null,
      )
      // Prefer the persisted choice, then the first non-expired ws,
      // and only fall back to an expired one if every membership is
      // expired (so AccessExpiredScreen has something to show).
      const storedMatch = list.find((w) => w.workspaceId === stored)
      const firstUsable = list.find((w) => !w.accessExpired)
      const active = storedMatch ?? firstUsable ?? list[0] ?? null
      setWorkspace(active)
      if (active) persistActive(active.workspaceId)
      setAuthed(true)
      void registerPushToken()
    } catch {
      clearAuthTokens()
      setAuthed(false)
      setWorkspaces([])
      setWorkspace(null)
    }
  }, [persistActive])

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const next = workspaces.find((w) => w.workspaceId === workspaceId)
      if (!next) return
      setWorkspace(next)
      persistActive(next.workspaceId)
    },
    [workspaces, persistActive],
  )

  useEffect(() => {
    setOnUnauthorized(signOut)
  }, [signOut])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await hydrateMobileTokenStore()
      if (cancelled) return
      await refresh()
      if (cancelled) return
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const value = useMemo(
    () => ({
      ready,
      authed,
      workspace,
      workspaces,
      switchWorkspace,
      refresh,
      signOut,
    }),
    [ready, authed, workspace, workspaces, switchWorkspace, refresh, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
