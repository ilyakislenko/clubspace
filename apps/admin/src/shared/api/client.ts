import {
  createAuthApi,
  createAxiosHttpClient,
  createMemoryTokenStore,
  createStorageTokenStore,
  persistAuthTokens,
  TokenStore,
  type HttpClient,
} from "@bjj-academy/api-client"
import type { AxiosInstance } from "axios"

import { createClient, createConfig, type Client } from "../sdk/client"

import { environment } from "../../environments/environment"

let tokenStore: TokenStore | null = null
let authApi: ReturnType<typeof createAuthApi> | null = null
let httpClient: HttpClient | null = null
let axiosInstance: AxiosInstance | null = null
let sdkClient: Client | null = null

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

export const getAxiosInstance = (): AxiosInstance => {
  ensureHttpClient()

  if (!axiosInstance) {
    throw new Error("Axios client is not initialized")
  }

  return axiosInstance
}

export const getSdkClient = (): Client => {
  if (!sdkClient) {
    sdkClient = createClient(
      createConfig({
        axios: getAxiosInstance(),
        baseURL: environment.apiBaseUrl,
      })
    )
  }

  return sdkClient
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

export const clearAuthTokens = (): void => {
  getTokenStore().clear()
}

const ensureHttpClient = () => {
  if (httpClient && axiosInstance) {
    return
  }

  const { client, axios } = createAxiosHttpClient({
    baseURL: environment.apiBaseUrl,
    tokenStore: getTokenStore(),
    onUnauthorized: () => {
      if (typeof window !== "undefined") {
        window.location.assign("/sign-in")
      }
    },
  })
  httpClient = client
  axiosInstance = axios
}
