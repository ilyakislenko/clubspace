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
  setOnForbidden,
  setOnUnauthorized,
} from "./api/client"
import {
  fetchMyWorkspaces,
  type WorkspaceSummary,
} from "./api/workspaces"
import {
  clearWorkspacesCache,
  loadWorkspacesCache,
  persistWorkspacesCache,
  pickActiveWorkspace,
} from "./api/workspaces-cache"
import { hydrateMobileTokenStore } from "./api/token-store"
import {
  registerPushToken,
  unregisterPushToken,
} from "../features/notifications/push-registration"
import { syncFavoritesFromServer } from "../features/profile/preferences-store"
import { clearResourceCache } from "./cache/resource-cache"

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
    void (async () => {
      // Unregister the push device BEFORE wiping tokens — the DELETE
      // /me/firebase-devices call is authenticated, so firing it without
      // awaiting raced the token wipe and 401'd, leaving the device still
      // registered to the previous user. Bounded by a timeout so a slow or
      // offline network can't stall sign-out (unregisterPushToken swallows
      // its own errors).
      await Promise.race([
        unregisterPushToken(),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ])
      // Await the SecureStore wipe BEFORE routing the UI to the sign-in
      // screen. Otherwise, if the user force-kills the app between the
      // UI flip and the keychain delete, the refresh token survives on
      // disk and the next launch silently re-authenticates as the
      // previous user.
      try {
        await clearAuthTokens()
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[auth] clearAuthTokens failed during sign-out", error)
      }
      persistActive(null)
      await clearWorkspacesCache()
      await clearResourceCache()
      setAuthed(false)
      setWorkspaces([])
      setWorkspace(null)
    })()
  }, [persistActive])

  const applyWorkspaces = useCallback(
    async (list: WorkspaceSummary[]) => {
      setWorkspaces(list)
      const stored = await SecureStore.getItemAsync(ACTIVE_WORKSPACE_KEY).catch(
        () => null,
      )
      const active = pickActiveWorkspace(list, stored)
      setWorkspace(active)
      if (active) persistActive(active.workspaceId)
      // Callers only reach here with a valid session (successful fetch or an
      // offline restore that had cached workspaces), so we're authenticated;
      // an empty list falls through to NoWorkspaceScreen, not sign-in.
      setAuthed(true)
      return active
    },
    [persistActive],
  )

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
      const active = await applyWorkspaces(list)
      // Cache the list so a later offline launch can restore this session.
      await persistWorkspacesCache(list)
      if (active) {
        // Pull the server's favorites snapshot into the local cache so a
        // fresh re-install (or another device's stars) shows up on the
        // ★ button without waiting for a manual toggle.
        void syncFavoritesFromServer(active.workspaceId)
      }
      void registerPushToken()
    } catch {
      // The axios client already clears tokens + signs out on a genuine 401
      // (see axios-http-client). So if the token is gone, this really was an
      // auth failure — stay logged out. If the token survives, this is a
      // network/offline error: DON'T wipe the session. Restore the last
      // cached workspaces so downloaded content stays reachable offline.
      if (!getAccessToken()) {
        setAuthed(false)
        setWorkspaces([])
        setWorkspace(null)
        return
      }
      const cached = await loadWorkspacesCache()
      if (cached.length === 0) {
        // Have a valid token but nothing cached yet (e.g. first launch while
        // offline). Keep the token — a later online launch will populate —
        // but there's nothing to show, so route to sign-in for now.
        setAuthed(false)
        setWorkspaces([])
        setWorkspace(null)
        return
      }
      await applyWorkspaces(cached)
    }
  }, [applyWorkspaces])

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const next = workspaces.find((w) => w.workspaceId === workspaceId)
      if (!next) return
      setWorkspace(next)
      persistActive(next.workspaceId)
      void syncFavoritesFromServer(next.workspaceId)
    },
    [workspaces, persistActive],
  )

  useEffect(() => {
    setOnUnauthorized(signOut)
  }, [signOut])

  // Any 403 from a guarded endpoint usually means the trainer just
  // revoked / expired this user's access. Re-fetch workspaces; the
  // accessExpired flag becomes true and App.tsx routes to the lock
  // screen on the next render.
  useEffect(() => {
    setOnForbidden(() => {
      void refresh()
    })
  }, [refresh])

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
