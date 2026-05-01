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

type AuthContextValue = {
  ready: boolean
  authed: boolean
  workspace: WorkspaceSummary | null
  /** Re-fetch current workspace after a successful sign-in. */
  refresh: () => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)

  const signOut = useCallback(() => {
    clearAuthTokens()
    setAuthed(false)
    setWorkspace(null)
  }, [])

  const refresh = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      setAuthed(false)
      setWorkspace(null)
      return
    }
    try {
      const response = await fetchMyWorkspaces()
      setWorkspace(response.data[0] ?? null)
      setAuthed(true)
    } catch {
      clearAuthTokens()
      setAuthed(false)
      setWorkspace(null)
    }
  }, [])

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
    () => ({ ready, authed, workspace, refresh, signOut }),
    [ready, authed, workspace, refresh, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
