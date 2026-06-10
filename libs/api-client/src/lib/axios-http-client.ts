import axios, {
  AxiosError,
  AxiosInstance,
  type AxiosRequestHeaders,
} from "axios"

import { persistAuthTokens } from "./auth-api"
import { HttpClient, HttpRequestConfig } from "./http-client"
import { TokenStore } from "./token-store"

export interface UnauthorizedContext {
  error: AxiosError
  status?: number
}

export interface ForbiddenContext {
  error: AxiosError
  status: number
  url?: string
}

export interface AxiosHttpClientConfig {
  baseURL: string
  tokenStore?: TokenStore
  onUnauthorized?: (context: UnauthorizedContext) => void
  /**
   * Fires when the server returns 403 from any non-auth endpoint. Lets
   * the host app surface "access revoked" state without waiting for the
   * next cold start.
   */
  onForbidden?: (context: ForbiddenContext) => void
}

export interface AxiosHttpClient {
  client: HttpClient
  axios: AxiosInstance
}

export const createAxiosHttpClient = (
  config: AxiosHttpClientConfig
): AxiosHttpClient => {
  const instance = axios.create({
    baseURL: config.baseURL,
  })
  let refreshPromise: Promise<void> | null = null

  // We treat the access token as expired EARLY_REFRESH_MS before the
  // server-issued expiry so a request that's already in flight when the
  // token expires doesn't race with a 401 round-trip.
  const EARLY_REFRESH_MS = 30_000

  const isAccessTokenExpired = (): boolean => {
    const expiresAt = config.tokenStore?.getExpiresAt()
    if (!expiresAt) return false
    // expiresAt is unix seconds (set by persistAuthTokens).
    return expiresAt * 1000 - EARLY_REFRESH_MS <= Date.now()
  }

  const startRefresh = (): Promise<void> | null => {
    const tokenStore = config.tokenStore
    if (!tokenStore) return null
    const refreshToken = tokenStore.getRefreshToken()
    if (!refreshToken) return null
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      const { data } = await instance.post("/refresh-token", {
        refreshToken,
      })
      // Guard against a sign-out vs. mid-flight-refresh race: if the
      // store was cleared (or rotated) while the refresh request was in
      // flight, do not write the new tokens back — otherwise the user
      // would silently be re-authenticated after clicking sign-out.
      const currentRefreshToken = tokenStore.getRefreshToken()
      if (currentRefreshToken !== refreshToken) {
        return
      }
      persistAuthTokens(tokenStore, data)
    })().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  instance.interceptors.request.use(async (request) => {
    // Don't try to refresh while sending a refresh request — would
    // deadlock and we want the response interceptor to handle a 401
    // from the refresh endpoint itself (revoked refresh token).
    if (
      !request.url?.includes("/refresh-token") &&
      config.tokenStore &&
      isAccessTokenExpired()
    ) {
      try {
        await startRefresh()
      } catch {
        // Fall through — the request will fire with the stale token,
        // hit 401, and the response interceptor will redirect.
      }
    }
    const accessToken = config.tokenStore?.getAccessToken()
    if (accessToken) {
      const headers = (request.headers ?? {}) as AxiosRequestHeaders
      headers.Authorization = `Bearer ${accessToken}`
      request.headers = headers
    }
    return request
  })

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const status = error.response?.status
      if (status === 401 && config.tokenStore) {
        const originalRequest = error.config
        if (!originalRequest) {
          return Promise.reject(error)
        }
        if (originalRequest.url?.includes("/refresh-token")) {
          // eslint-disable-next-line no-console
          console.warn(
            "[auth] refresh-token endpoint returned 401 — clearing tokens and signing out",
          )
          await config.tokenStore.clear()
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        if ((originalRequest as { _retry?: boolean })._retry) {
          return Promise.reject(error)
        }
        const refreshToken = config.tokenStore.getRefreshToken()
        if (!refreshToken) {
          // eslint-disable-next-line no-console
          console.warn(
            "[auth] 401 on",
            originalRequest.url,
            "but no refresh token in store — signing out",
          )
          await config.tokenStore.clear()
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        const promise = startRefresh()
        if (!promise) {
          await config.tokenStore.clear()
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        try {
          await promise
        } catch {
          await config.tokenStore.clear()
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        ;(originalRequest as { _retry?: boolean })._retry = true
        return instance.request(originalRequest)
      }
      if (status === 403) {
        config.onForbidden?.({
          error,
          status,
          url: error.config?.url,
        })
      }
      return Promise.reject(error)
    }
  )

  const client: HttpClient = {
    request: async <TResponse, TBody = unknown>(
      request: HttpRequestConfig<TBody>
    ): Promise<TResponse> => {
      const response = await instance.request<TResponse>({
        method: request.method,
        url: request.url,
        data: request.data,
        params: request.params,
        headers: request.headers,
      })

      return response.data
    },
  }

  return { client, axios: instance }
}
