import axios, {
  AxiosError,
  AxiosInstance,
  type AxiosRequestConfig,
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

/**
 * Where the refresh token travels. "body" (default): in JSON, kept in the
 * TokenStore (mobile, PWA, student web app). "cookie": in an HttpOnly cookie
 * the API sets on its own domain, out of reach of page scripts (admin panel).
 */
export type TokenTransport = "body" | "cookie"

export const TOKEN_TRANSPORT_HEADER = "X-Token-Transport"

// Routes that issue, rotate or end a session. In the cookie transport they go
// with credentials and the transport header, so the API can set, read and
// clear the refresh cookie; every other request stays credential-free.
const SESSION_ROUTES: Record<string, true> = {
  "/sign-in": true,
  "/refresh-token": true,
  "/sign-out": true,
  "/me/sign-out-everywhere": true,
}

export interface AxiosHttpClientConfig {
  baseURL: string
  /** Request timeout in ms. Unset = axios default (no timeout). */
  timeout?: number
  tokenStore?: TokenStore
  /** Default "body". See TokenTransport. */
  tokenTransport?: TokenTransport
  /**
   * Runs each refresh exclusively across everything sharing the refresh
   * token (browser tabs sharing one cookie). Presenting a token another tab
   * has just rotated counts as reuse and ends the session, so tabs must take
   * turns: the one that waited then sends the already rotated cookie.
   */
  refreshLock?: <T>(run: () => Promise<T>) => Promise<T>
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
  /**
   * Mints a fresh access token from the stored refresh token (or, in the
   * cookie transport, from the refresh cookie) — how a page load gets back
   * a session whose access token lived only in memory. Resolves whether a
   * session is in the store afterwards; a dead session clears the store but
   * never fires onUnauthorized, so a sign-in page can probe it too.
   */
  refreshSession: () => Promise<boolean>
}

// Marks the probe refresh of refreshSession: its 401 means "no session",
// not "the session just ended", so the host is not told to sign out.
type SilentRequest = AxiosRequestConfig & { _silent?: boolean }

export const createAxiosHttpClient = (
  config: AxiosHttpClientConfig
): AxiosHttpClient => {
  const instance = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
  })
  const cookieTransport = config.tokenTransport === "cookie"
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

  const startRefresh = (silent = false): Promise<void> | null => {
    const tokenStore = config.tokenStore
    if (!tokenStore) return null
    const refreshToken = tokenStore.getRefreshToken()
    // The cookie transport has nothing to check: only the API sees the token.
    if (!cookieTransport && !refreshToken) return null
    if (refreshPromise) return refreshPromise
    // What this refresh replaces. A sign-out (store cleared) or a new
    // sign-in while it is in flight changes it, and the late answer must
    // not overwrite that — otherwise the user would silently be
    // re-authenticated after clicking sign-out.
    const replaces = cookieTransport ? tokenStore.getAccessToken() : refreshToken
    const run = async () => {
      const request: SilentRequest = { _silent: silent }
      const { data } = await instance.post(
        "/refresh-token",
        cookieTransport ? {} : { refreshToken },
        request
      )
      const now = cookieTransport
        ? tokenStore.getAccessToken()
        : tokenStore.getRefreshToken()
      if (now !== replaces) return
      persistAuthTokens(tokenStore, data)
    }
    refreshPromise = (config.refreshLock ? config.refreshLock(run) : run()).finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  const refreshSession = async (): Promise<boolean> => {
    const promise = startRefresh(true)
    if (!promise) return false
    try {
      await promise
    } catch {
      return false
    }
    return Boolean(config.tokenStore?.getAccessToken())
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
    const headers = (request.headers ?? {}) as AxiosRequestHeaders
    const accessToken = config.tokenStore?.getAccessToken()
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }
    if (cookieTransport && SESSION_ROUTES[request.url?.split("?")[0] ?? ""]) {
      headers[TOKEN_TRANSPORT_HEADER] = "cookie"
      request.withCredentials = true
    }
    request.headers = headers
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
          // A probe that found no session: nothing to clear or report (the
          // store may meanwhile hold a sign-in that finished first).
          if ("_silent" in originalRequest && originalRequest._silent === true) {
            return Promise.reject(error)
          }
          await config.tokenStore.clear()
          console.warn(
            "[auth] refresh-token endpoint returned 401 — clearing tokens and signing out",
          )
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        if ((originalRequest as { _retry?: boolean })._retry) {
          return Promise.reject(error)
        }
        if (!cookieTransport && !config.tokenStore.getRefreshToken()) {
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

  return { client, axios: instance, refreshSession }
}
