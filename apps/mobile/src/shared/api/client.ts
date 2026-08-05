import {
  createAuthApi,
  createAxiosHttpClient,
  persistAuthTokens,
  type HttpClient,
  type TokenStore,
} from "@clubspace/api-client"

import { environment } from "../env"
import { createMobileTokenStore } from "./token-store"

let tokenStore: TokenStore | null = null
let authApi: ReturnType<typeof createAuthApi> | null = null
let httpClient: HttpClient | null = null
let onUnauthorizedCallback: (() => void) | null = null
let onForbiddenCallback: (() => void) | null = null

const getTokenStore = (): TokenStore => {
  if (!tokenStore) tokenStore = createMobileTokenStore()
  return tokenStore
}

const ensureHttpClient = () => {
  if (httpClient) return
  const { client } = createAxiosHttpClient({
    baseURL: environment.apiBaseUrl,
    tokenStore: getTokenStore(),
    onUnauthorized: () => onUnauthorizedCallback?.(),
    onForbidden: () => onForbiddenCallback?.(),
  })
  httpClient = client
}

export const setOnUnauthorized = (cb: () => void) => {
  onUnauthorizedCallback = cb
}

export const setOnForbidden = (cb: () => void) => {
  onForbiddenCallback = cb
}

export const getApiClient = (): HttpClient => {
  ensureHttpClient()
  if (!httpClient) {
    throw new Error("API client is not initialized")
  }
  return httpClient
}

export const getAuthApi = () => {
  if (!authApi) authApi = createAuthApi(getApiClient())
  return authApi
}

export const getAccessToken = () => getTokenStore().getAccessToken()

export const storeAuthTokens = (
  response: Parameters<typeof persistAuthTokens>[1],
) => {
  persistAuthTokens(getTokenStore(), response)
}

export const clearAuthTokens = (): Promise<void> =>
  Promise.resolve(getTokenStore().clear())
