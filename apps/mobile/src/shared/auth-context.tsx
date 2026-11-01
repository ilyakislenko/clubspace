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
import { listMyDependents, type MyDependent } from "./api/dependents"
import { fetchSignedInUser } from "./api/me"
import {
  fetchMyWorkspaces,
  type WorkspaceSummary,
} from "./api/workspaces"
import {
  clearWorkspacesCache,
  loadActiveWorkspaceId,
  loadWorkspacesCache,
  persistActiveWorkspaceId,
  persistWorkspacesCache,
  pickActiveWorkspace,
} from "./api/workspaces-cache"
import { hydrateMobileTokenStore } from "./api/token-store"
import {
  restoreActingAs,
  saveActingAs,
  type ActingAs,
} from "./acting-as"
import {
  registerPushToken,
  unregisterPushToken,
} from "../features/notifications/push-registration"
import { syncFavoritesFromServer } from "../features/profile/preferences-store"
import { isConsentConflictError, isConsentRequiredError } from "./consent-errors"
import {
  reconcileActingAs,
  switchableDependents,
  toActingAs,
} from "../features/children/children-helpers"
import { canSyncVideoData } from "./feature-flags"
import { createForbiddenRefreshGate } from "./forbidden-refresh-gate"
import { cleanupOnSignOut, reconcileLocalOwner } from "./local-owner"
import { getProfileScopeId } from "./profile-scope"
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
  /** The child the guardian acts for right now; null = themselves. */
  actingAs: ActingAs | null
  /** The guardian's children: confirmed and club invitations awaiting them. */
  dependents: MyDependent[]
  /**
   * Acts for a confirmed child (or back as the guardian with null): every
   * allowlisted request carries the child's X-Act-As from here on, and the
   * child's clubs replace the guardian's. Rejects when the clubs can't be
   * loaded (offline with nothing cached) — the previous profile stays.
   */
  switchProfile: (dependentId: string | null) => Promise<void>
}

type SignOutOptions = { wipeLocal?: boolean; forced?: boolean }

const AuthContext = createContext<AuthContextValue | null>(null)

const syncVideoData = (active: WorkspaceSummary | null) => {
  // So a re-install or another device's stars show up without a manual
  // toggle. Skipped with videos off / access lapsed: nothing to sync, and
  // a refused call would only trigger another refresh.
  if (active && canSyncVideoData(active)) {
    void syncFavoritesFromServer(active.workspaceId)
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [consent, setConsent] = useState<MyConsent | null>(null)
  const [actingAs, setActingAs] = useState<ActingAs | null>(null)
  const [dependents, setDependents] = useState<MyDependent[]>([])

  const ownerChecked = useRef(false)
  // Read by callbacks without re-creating them on every profile change.
  const actingAsRef = useRef<ActingAs | null>(null)
  const dependentsRef = useRef<MyDependent[]>([])
  // Every child profile this session stored data for, so sign-out can clear
  // each one's workspace keys.
  const knownProfiles = useRef(new Set<string>())

  const signOut = useCallback((opts?: SignOutOptions) => {
    void (async () => {
      // Must precede the token wipe: this call is authenticated, and racing it
      // 401'd, leaving the device registered to the previous user. Timeout-
      // bounded so an offline network can't stall sign-out. Never sent as a
      // child (not on the act-as allowlist): the device is the guardian's.
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
      const profiles = [
        null,
        ...knownProfiles.current,
        ...dependentsRef.current.map((d) => d.id),
      ]
      await saveActingAs(null)
      actingAsRef.current = null
      knownProfiles.current.clear()
      dependentsRef.current = []
      if (!opts?.forced) await clearPendingJoin()
      await Promise.all(profiles.map((id) => clearWorkspacesCache(id)))
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
      setActingAs(null)
      setDependents([])
    })()
  }, [])

  // Commits a profile's clubs. The state flips in one synchronous batch so the
  // navigator never renders one profile with another's clubs.
  const applyWorkspaces = useCallback(
    async (list: WorkspaceSummary[], profile: ActingAs | null) => {
      const profileId = profile?.id ?? null
      const stored = await loadActiveWorkspaceId(profileId)
      const active = pickActiveWorkspace(list, stored)
      actingAsRef.current = profile
      if (profileId) knownProfiles.current.add(profileId)
      setActingAs(profile)
      setWorkspaces(list)
      setWorkspace(active)
      // Authenticated by this point; an empty list means NoWorkspaceScreen,
      // not sign-in.
      setAuthed(true)
      if (active) void persistActiveWorkspaceId(active.workspaceId, profileId)
      return active
    },
    [],
  )

  // The guardian's children decide which profile the rest loads as: a child
  // that is gone or no longer confirmed drops back to the guardian. A failed
  // fetch keeps the current profile (offline must not switch anyone).
  const syncDependents = useCallback(async (): Promise<ActingAs | null> => {
    const current = actingAsRef.current
    let list: MyDependent[]
    try {
      list = (await listMyDependents()).data
    } catch {
      return current
    }
    dependentsRef.current = list
    setDependents(list)
    const next = reconcileActingAs(current, list)
    if (current && !next) {
      await clearWorkspacesCache(current.id)
      knownProfiles.current.delete(current.id)
    }
    // Persist a drop or a rename (the pill shows the stored name offline).
    if (JSON.stringify(next) !== JSON.stringify(current)) await saveActingAs(next)
    return next
  }, [])

  const refresh = useCallback(async (opts?: { activate?: string }) => {
    if (opts?.activate) {
      // Before the fetch, so pickActiveWorkspace selects the new club.
      await persistActiveWorkspaceId(opts.activate, getProfileScopeId())
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
    // The profile requests go out as; the guardian's children may change it
    // (see syncDependents) once past the consent.
    let profile = actingAsRef.current
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
      profile = await syncDependents()
      const response = await fetchMyWorkspaces()
      const list = response.data
      // Before authed flips: a different account than the one that owns the
      // on-device data wipes it first. Once per session; offline skips it.
      // Always the signed-in guardian's id, never a child's.
      if (!ownerChecked.current) {
        try {
          await reconcileLocalOwner((await fetchSignedInUser()).id)
          ownerChecked.current = true
        } catch {
          /* offline — retried on the next refresh */
        }
      }
      const active = await applyWorkspaces(list, profile)
      // Only after the workspaces are in: clearing it earlier would flash the
      // no-club onboarding screen right after accepting.
      setConsent(null)
      await persistWorkspacesCache(list, profile?.id ?? null)
      syncVideoData(active)
      // Ask for notification permission only once the member is in a club.
      // The device is always registered to the guardian (not allowlisted).
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
      const cached = await loadWorkspacesCache(profile?.id ?? null)
      if (cached.length === 0) {
        // Valid token but nothing cached (first launch offline). Keep the
        // token; there's just nothing to show yet.
        setAuthed(false)
        setWorkspaces([])
        setWorkspace(null)
        return
      }
      await applyWorkspaces(cached, profile)
      // Consent unknown (offline before the check) keeps whatever was shown;
      // the server still refuses club calls and the 403 hook brings it back.
      if (consentAccepted) setConsent(null)
    }
  }, [applyWorkspaces, syncDependents])

  const switchProfile = useCallback(
    async (dependentId: string | null) => {
      const previous = actingAsRef.current
      if ((previous?.id ?? null) === dependentId) return
      const target = dependentId
        ? switchableDependents(dependentsRef.current).find(
            (d) => d.id === dependentId,
          )
        : null
      if (dependentId && !target) {
        throw new Error("Профиль ребёнка недоступен — обновите список детей")
      }
      const next = target ? toActingAs(target) : null
      // From here on every allowlisted request carries the new profile.
      await saveActingAs(next)
      let list: WorkspaceSummary[]
      try {
        list = (await fetchMyWorkspaces()).data
        await persistWorkspacesCache(list, next?.id ?? null)
      } catch (error) {
        list = await loadWorkspacesCache(next?.id ?? null)
        if (list.length === 0) {
          await saveActingAs(previous)
          throw error
        }
      }
      syncVideoData(await applyWorkspaces(list, next))
    },
    [applyWorkspaces],
  )

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const next = workspaces.find((w) => w.workspaceId === workspaceId)
      if (!next) return
      setWorkspace(next)
      void persistActiveWorkspaceId(next.workspaceId, getProfileScopeId())
      if (canSyncVideoData(next)) void syncFavoritesFromServer(next.workspaceId)
    },
    [workspaces],
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
      // Before the first request: it decides which profile it goes out as.
      actingAsRef.current = await restoreActingAs()
      setActingAs(actingAsRef.current)
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
      actingAs,
      dependents,
      switchProfile,
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
      actingAs,
      dependents,
      switchProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
