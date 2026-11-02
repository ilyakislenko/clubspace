import {
  createAuthApi,
  createAxiosHttpClient,
  createMemoryTokenStore,
  createStorageTokenStore,
  persistAuthTokens,
  TokenStore,
  type HttpClient,
} from "@clubspace/api-client"

import { environment } from "../../environments/environment"
import { isConsentRequiredError } from "../lib/consent-required"
import { signInHref } from "../lib/sign-in-return"

let tokenStore: TokenStore | null = null
let authApi: ReturnType<typeof createAuthApi> | null = null
let httpClient: HttpClient | null = null

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

const getTokenStore = (): TokenStore => {
  if (!tokenStore) {
    tokenStore =
      typeof window !== "undefined"
        ? createStorageTokenStore(window.localStorage)
        : createMemoryTokenStore()
  }

  return tokenStore
}

export const getApiClient = (): HttpClient => {
  ensureHttpClient()

  if (!httpClient) {
    throw new Error("API client is not initialized")
  }

  return httpClient
}

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

  return getTokenStore().getAccessToken()
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
  persistAuthTokens(getTokenStore(), response)
  resetSessionCaches()
}

export const getRefreshToken = (): string | null => {
  if (typeof window === "undefined") {
    return null
  }

  return getTokenStore().getRefreshToken()
}

export const clearAuthTokens = (): void => {
  getTokenStore().clear()
  resetSessionCaches()
}

// Revoke the refresh token server-side, then clear local tokens. The server
// call is best-effort: sign-out must always complete locally even if the
// network or endpoint fails, so we never block on or throw from it.
export const signOut = async (): Promise<void> => {
  const refreshToken = getRefreshToken()
  if (refreshToken) {
    try {
      await getApiClient().request<{ status: string }, { refreshToken: string }>(
        {
          method: "post",
          url: "/sign-out",
          data: { refreshToken },
        }
      )
    } catch {
      // Ignore — proceed to clear local tokens regardless.
    }
  }
  clearAuthTokens()
}

const ensureHttpClient = () => {
  if (httpClient) {
    return
  }

  const { client } = createAxiosHttpClient({
    baseURL: environment.apiBaseUrl,
    tokenStore: getTokenStore(),
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
  httpClient = client
}
