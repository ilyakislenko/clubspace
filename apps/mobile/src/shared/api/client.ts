import {
  createAuthApi,
  createAxiosHttpClient,
  persistAuthTokens,
  type ForbiddenContext,
  type HttpClient,
  type HttpRequestConfig,
  type TokenStore,
} from "@clubspace/api-client"

import { environment } from "../env"
import { getProfileScopeId } from "../profile-scope"
import { ACT_AS_HEADER, shouldSendActAs } from "./act-as"
import { createMobileTokenStore } from "./token-store"

let tokenStore: TokenStore | null = null
let authApi: ReturnType<typeof createAuthApi> | null = null
let rawClient: HttpClient | null = null
let httpClient: HttpClient | null = null
let onUnauthorizedCallback: (() => void) | null = null
let onForbiddenCallback: ((context: ForbiddenContext) => void) | null = null

const getTokenStore = (): TokenStore => {
  if (!tokenStore) tokenStore = createMobileTokenStore()
  return tokenStore
}

const ensureHttpClient = () => {
  if (httpClient) return
  const { client } = createAxiosHttpClient({
    baseURL: environment.apiBaseUrl,
    // Without a timeout a dead network leaves every spinner running forever.
    timeout: 15_000,
    tokenStore: getTokenStore(),
    onUnauthorized: () => onUnauthorizedCallback?.(),
    onForbidden: (context) => onForbiddenCallback?.(context),
  })
  rawClient = client
  // Every request goes out as the active profile (see requestAs).
  httpClient = {
    request: (config) => requestAs(getProfileScopeId(), config),
  }
}

/**
 * Sends a request as a given profile instead of the active one: null = the
 * guardian. For replaying a write queued under another profile (outbox) and
 * for the few reads that must be the guardian's even in a child profile.
 *
 * The one place X-Act-As is attached: only when acting for a child, and only
 * on the routes the server accepts it on. Everything else — push devices, the
 * inbox, notification settings, sign-out, account deletion, managing children
 * — always runs as the signed-in guardian.
 */
export const requestAs = <TResponse = unknown, TBody = unknown>(
  dependentId: string | null,
  config: HttpRequestConfig<TBody>,
): Promise<TResponse> => {
  ensureHttpClient()
  if (!rawClient) throw new Error("API client is not initialized")
  const headers =
    dependentId && shouldSendActAs(config.method, config.url)
      ? { ...config.headers, [ACT_AS_HEADER]: dependentId }
      : config.headers
  return rawClient.request<TResponse, TBody>({ ...config, headers })
}

export const setOnUnauthorized = (cb: () => void) => {
  onUnauthorizedCallback = cb
}

export const setOnForbidden = (cb: (context: ForbiddenContext) => void) => {
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
