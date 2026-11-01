import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AppState } from "react-native"

import { kvDelete, kvGet, kvSet } from "./kv"

import {
  clearAuthTokens,
  getAccessToken,
  setOnForbidden,
  setOnUnauthorized,
} from "./api/client"
import {
  acceptMyConsent,
  getMyConsent,
  type MyConsent,
} from "./api/consent"
import { fetchMe } from "./api/me"
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
import { isConsentConflictError, isConsentRequiredError } from "./consent-errors"
import { canSyncVideoData } from "./feature-flags"
import { createForbiddenRefreshGate } from "./forbidden-refresh-gate"
import { cleanupOnSignOut, reconcileLocalOwner } from "./local-owner"
import { clearResourceCache } from "./cache/resource-cache"
import { clearOutbox } from "./outbox/outbox"
import { clearPendingJoin } from "../features/join/pending-join"

type AuthContextValue = {
  ready: boolean
  authed: boolean
  workspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  switchWorkspace: (workspaceId: string) => void
  /**
   * Re-fetch current workspace after a successful sign-in. `activate` makes the
   * given club the active one (a club just joined by code).
   */
  refresh: (opts?: { activate?: string }) => Promise<void>
  /**
   * wipeLocal: explicit sign-out / deletion only. forced: the 401 path — keeps
   * device data and the join link the member opened before signing in again.
   */
  signOut: (opts?: SignOutOptions) => void
  /**
   * The personal-data consent edition the user still has to accept; null once
   * accepted (or not known yet, offline). While set, App.tsx shows only the
   * consent screen and nothing club-scoped runs — the server would refuse it.
   */
  consent: MyConsent | null
  /**
   * Accepts `version` (the edition on screen) and continues into the app.
   * Rethrows on failure; on a 409 the newer edition is loaded first.
   */
  acceptConsent: (version: string) => Promise<void>
}

type SignOutOptions = { wipeLocal?: boolean; forced?: boolean }

const AuthContext = createContext<AuthContextValue | null>(null)

const ACTIVE_WORKSPACE_KEY = "clubspace.activeWorkspaceId"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [consent, setConsent] = useState<MyConsent | null>(null)

  const ownerChecked = useRef(false)

  const persistActive = useCallback((id: string | null) => {
    if (id) {
      void kvSet(ACTIVE_WORKSPACE_KEY, id).catch(() => {
        /* noop */
      })
    } else {
      void kvDelete(ACTIVE_WORKSPACE_KEY).catch(() => {
        /* noop */
      })
    }
  }, [])

  const signOut = useCallback((opts?: SignOutOptions) => {
    void (async () => {
      // Must precede the token wipe: this call is authenticated, and racing it
      // 401'd, leaving the device registered to the previous user. Timeout-
      // bounded so an offline network can't stall sign-out.
      await Promise.race([
        unregisterPushToken(),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ])
      // Await the wipe before routing to sign-in: a force-kill between the UI
      // flip and the keychain delete leaves a refresh token that silently
      // re-authenticates the previous user on next launch.
      try {
        await clearAuthTokens()
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[auth] clearAuthTokens failed during sign-out", error)
      }
      ownerChecked.current = false
      persistActive(null)
      if (!opts?.forced) await clearPendingJoin()
      await clearWorkspacesCache()
      await clearResourceCache()
      await clearOutbox()
      // Per-user files + downloads must not leak to the next person on this
      // phone; device prefs (theme, autoplay, ...) are kept. Only on an
      // explicit sign-out: a forced one (expired refresh token, 5xx during a
      // deploy) must not destroy device-only notes/downloads.
      try {
        await cleanupOnSignOut({ wipeLocal: opts?.wipeLocal === true })
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[auth] local data wipe failed during sign-out", error)
      }
      setAuthed(false)
      setWorkspaces([])
      setWorkspace(null)
      setConsent(null)
    })()
  }, [persistActive])

  const applyWorkspaces = useCallback(
    async (list: WorkspaceSummary[]) => {
      setWorkspaces(list)
      const stored = await kvGet(ACTIVE_WORKSPACE_KEY).catch(() => null)
      const active = pickActiveWorkspace(list, stored)
      setWorkspace(active)
      if (active) persistActive(active.workspaceId)
      // Authenticated by this point; an empty list means NoWorkspaceScreen,
      // not sign-in.
      setAuthed(true)
      return active
    },
    [persistActive],
  )

  const refresh = useCallback(async (opts?: { activate?: string }) => {
    if (opts?.activate) {
      // Before the fetch, so pickActiveWorkspace selects the new club.
      await kvSet(ACTIVE_WORKSPACE_KEY, opts.activate).catch(() => undefined)
    }
    const token = getAccessToken()
    if (!token) {
      setAuthed(false)
      setWorkspaces([])
      setWorkspace(null)
      setConsent(null)
      return
    }
    let consentAccepted = false
    try {
      // First, before anything club-scoped: until the current edition is
      // accepted the server refuses those calls with CONSENT_REQUIRED.
      const consentStatus = await getMyConsent()
      if (consentStatus.required) {
        setConsent(consentStatus)
        setAuthed(true)
        return
      }
      consentAccepted = true
      const response = await fetchMyWorkspaces()
      const list = response.data
      // Before authed flips: a different account than the one that owns the
      // on-device data wipes it first. Once per session; offline skips it.
      if (!ownerChecked.current) {
        try {
          await reconcileLocalOwner((await fetchMe()).id)
          ownerChecked.current = true
        } catch {
          /* offline — retried on the next refresh */
        }
      }
      const active = await applyWorkspaces(list)
      // Only after the workspaces are in: clearing it earlier would flash the
      // no-club onboarding screen right after accepting.
      setConsent(null)
      await persistWorkspacesCache(list)
      if (active && canSyncVideoData(active)) {
        // So a re-install or another device's stars show up without a manual
        // toggle. Skipped with videos off / access lapsed: nothing to sync, and
        // a refused call would only trigger another refresh.
        void syncFavoritesFromServer(active.workspaceId)
      }
      // Ask for notification permission only once the member is in a club.
      void registerPushToken({ requestPermission: active != null && !active.accessExpired })
    } catch {
      // axios-http-client already clears tokens on a genuine 401, so a missing
      // token means real auth failure. A surviving token means this was a
      // network error — keep the session and restore the cached workspaces.
      if (!getAccessToken()) {
        setAuthed(false)
        setWorkspaces([])
        setWorkspace(null)
        setConsent(null)
        return
      }
      const cached = await loadWorkspacesCache()
      if (cached.length === 0) {
        // Valid token but nothing cached (first launch offline). Keep the
        // token; there's just nothing to show yet.
        setAuthed(false)
        setWorkspaces([])
        setWorkspace(null)
        return
      }
      await applyWorkspaces(cached)
      // Consent unknown (offline before the check) keeps whatever was shown;
      // the server still refuses club calls and the 403 hook brings it back.
      if (consentAccepted) setConsent(null)
    }
  }, [applyWorkspaces])

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const next = workspaces.find((w) => w.workspaceId === workspaceId)
      if (!next) return
      setWorkspace(next)
      persistActive(next.workspaceId)
      if (canSyncVideoData(next)) void syncFavoritesFromServer(next.workspaceId)
    },
    [workspaces, persistActive],
  )

  useEffect(() => {
    setOnUnauthorized(() => signOut({ forced: true }))
  }, [signOut])

  // A pending consent (new edition published mid-session) refuses every club
  // call at once; one re-read of /me/consent is enough to show the screen.
  const consentCheckInFlight = useRef(false)
  const recheckConsent = useCallback(() => {
    if (consentCheckInFlight.current) return
    consentCheckInFlight.current = true
    void (async () => {
      try {
        const status = await getMyConsent()
        if (status.required && getAccessToken()) setConsent(status)
      } catch {
        /* offline — the next refused call or refresh asks again */
      } finally {
        consentCheckInFlight.current = false
      }
    })()
  }, [])

  // Any other 403 usually means access was just revoked/expired. Re-fetching
  // flips accessExpired, and App.tsx routes to the lock screen.
  // Gated: one 403-triggered refresh at a time, at most one per 30 s, so a
  // refused call can't loop with the refresh it causes.
  const forbiddenGate = useRef(createForbiddenRefreshGate())
  useEffect(() => {
    setOnForbidden(({ error }) => {
      if (isConsentRequiredError(error)) {
        recheckConsent()
        return
      }
      void forbiddenGate.current(refresh)
    })
  }, [refresh, recheckConsent])

  const acceptConsent = useCallback(
    async (version: string) => {
      try {
        await acceptMyConsent(version)
      } catch (error) {
        if (isConsentConflictError(error)) {
          // A newer edition went live while the old one was on screen: show
          // it, so the user accepts what they actually read.
          const latest = await getMyConsent().catch(() => null)
          if (latest) setConsent(latest.required ? latest : null)
        }
        throw error
      }
      await refresh()
    },
    [refresh],
  )

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

  // Picks up flags / access expiry / club changes without a cold relaunch.
  // refresh() is idempotent and keeps the session on network errors, and
  // 'active' only fires on a transition, so this can't double-run on launch.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh()
    })
    return () => sub.remove()
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
      consent,
      acceptConsent,
    }),
    [
      ready,
      authed,
      workspace,
      workspaces,
      switchWorkspace,
      refresh,
      signOut,
      consent,
      acceptConsent,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
