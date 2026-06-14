import {
  createAuthApi,
  createAxiosHttpClient,
  createMemoryTokenStore,
  createStorageTokenStore,
  persistAuthTokens,
  TokenStore,
  type HttpClient,
} from "@bjj-academy/api-client"

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

const ensureHttpClient = () => {
  if (httpClient) return

  const { client } = createAxiosHttpClient({
    baseURL: environment.apiBaseUrl,
    tokenStore: getTokenStore(),
    onUnauthorized: () => {
      // Don't hard-redirect when we're already on the sign-in page: a 401 from
      // the sign-in/OTP request itself would otherwise reload the page and
      // swallow the "wrong code" error before the user can read it.
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/sign-in"
      ) {
        window.location.assign("/sign-in")
      }
    },
  })
  httpClient = client
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
  if (typeof window === "undefined") return null
  return getTokenStore().getAccessToken()
}

export const storeAuthTokens = (
  response: Parameters<typeof persistAuthTokens>[1]
) => {
  persistAuthTokens(getTokenStore(), response)
}

export const clearAuthTokens = () => {
  getTokenStore().clear()
}
