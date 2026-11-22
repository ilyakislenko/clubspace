import {
  createAuthApi,
  createAxiosHttpClient,
  createMemoryTokenStore,
  persistAuthTokens,
  type AxiosHttpClient,
  type HttpClient,
} from "@clubspace/api-client"

import { environment } from "../../environments/environment"
import { isConsentRequiredError } from "../lib/consent-required"
import { signInHref } from "../lib/sign-in-return"

// The access token lives in this module's memory only, never in storage a
// script could read back later; the refresh token is an HttpOnly cookie on the
// API domain (the cookie transport, X-Token-Transport: cookie). A page load
// gets its session back through restoreSession(); each tab holds its own
// access token.
const tokenStore = createMemoryTokenStore()
let authApi: ReturnType<typeof createAuthApi> | null = null
let http: AxiosHttpClient | null = null

// Where the admin used to persist the session (createStorageTokenStore's
// default keys). Deleted on load so a refresh token from before the cookie
// transport doesn't outlive it in localStorage.
export const LEGACY_TOKEN_KEYS = ["accessToken", "refreshToken", "expiresAt", "userId"] as const

// Tabs share one refresh cookie, and presenting a cookie another tab has just
// rotated counts as token reuse (the whole session ends). The Web Locks API
// makes tabs refresh one at a time; the one that waited sends the new cookie.
const refreshLock = async <T>(run: () => Promise<T>): Promise<T> => {
  if (typeof navigator === "undefined" || !navigator.locks) return run()
  let result!: T
  await navigator.locks.request("clubspace-admin-refresh", async () => {
    result = await run()
  })
  return result
}

// Notified when any request answers 403 CONSENT_REQUIRED — the consent edition
// changed mid-session — so the dashboard can bring the consent gate back
// instead of each screen showing a generic error.
const consentRequiredListeners = new Set<() => void>()

export const onConsentRequired = (listener: () => void): (() => void) => {
  consentRequiredListeners.add(listener)
  return () => {
    consentRequiredListeners.delete(listener)
  }
}

const getHttp = (): AxiosHttpClient => {
  if (http) return http

  if (typeof window !== "undefined") {
    for (const key of LEGACY_TOKEN_KEYS) window.localStorage.removeItem(key)
  }

  http = createAxiosHttpClient({
    baseURL: environment.apiBaseUrl,
    tokenStore,
    tokenTransport: "cookie",
    refreshLock,
    onUnauthorized: () => {
      if (typeof window !== "undefined") {
        const { pathname, search } = window.location
        window.location.assign(signInHref(pathname + search))
      }
    },
    onForbidden: ({ error }) => {
      if (!isConsentRequiredError(error)) return
      for (const listener of consentRequiredListeners) listener()
    },
  })
  return http
}

export const getApiClient = (): HttpClient => getHttp().client

export const getAuthApi = () => {
  if (!authApi) {
    authApi = createAuthApi(getApiClient())
  }

  return authApi
}

export const getAccessToken = (): string | null => {
  if (typeof window === "undefined") {
    return null
  }

  return tokenStore.getAccessToken()
}

// Whether this tab has a session, minting an access token from the refresh
// cookie when memory holds none (a fresh page load). Concurrent callers share
// one refresh.
export const restoreSession = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false
  if (tokenStore.getAccessToken()) return true
  return getHttp().refreshSession()
}

// Per-account caches (the membership behind the sidebar) register a reset
// here, so the next account signed in on this tab never starts from the
// previous one's role.
const sessionResets = new Set<() => void>()

export const onAuthSessionChange = (reset: () => void): void => {
  sessionResets.add(reset)
}

const resetSessionCaches = (): void => {
  sessionResets.forEach((reset) => reset())
}

export const storeAuthTokens = (
  response: Parameters<typeof persistAuthTokens>[1]
) => {
  persistAuthTokens(tokenStore, response)
  resetSessionCaches()
}

export const clearAuthTokens = (): void => {
  tokenStore.clear()
  resetSessionCaches()
}

// Revoke the session server-side (the API reads and clears the refresh
// cookie), then forget the access token. The server call is best-effort:
// sign-out must always complete locally even if the network or endpoint
// fails, so we never block on or throw from it.
export const signOut = async (): Promise<void> => {
  try {
    await getApiClient().request<{ status: string }, Record<string, never>>({
      method: "post",
      url: "/sign-out",
      data: {},
    })
  } catch {
    // Ignore — proceed to clear local tokens regardless.
  }
  clearAuthTokens()
}
