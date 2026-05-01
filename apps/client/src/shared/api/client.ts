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
      if (typeof window !== "undefined") {
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
