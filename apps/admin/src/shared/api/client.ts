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

let tokenStore: TokenStore | null = null
let authApi: ReturnType<typeof createAuthApi> | null = null
let httpClient: HttpClient | null = null

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

export const storeAuthTokens = (
  response: Parameters<typeof persistAuthTokens>[1]
) => {
  persistAuthTokens(getTokenStore(), response)
}

export const getRefreshToken = (): string | null => {
  if (typeof window === "undefined") {
    return null
  }

  return getTokenStore().getRefreshToken()
}

export const clearAuthTokens = (): void => {
  getTokenStore().clear()
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
        window.location.assign("/sign-in")
      }
    },
  })
  httpClient = client
}
