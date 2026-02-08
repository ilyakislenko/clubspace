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

export interface AxiosHttpClientConfig {
  baseURL: string
  tokenStore?: TokenStore
  onUnauthorized?: (context: UnauthorizedContext) => void
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

  instance.interceptors.request.use((request) => {
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
          config.tokenStore.clear()
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        if ((originalRequest as { _retry?: boolean })._retry) {
          return Promise.reject(error)
        }
        const refreshToken = config.tokenStore.getRefreshToken()
        if (!refreshToken) {
          config.tokenStore.clear()
          config.onUnauthorized?.({ error, status })
          return Promise.reject(error)
        }
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const { data } = await instance.post("/refresh-token", {
              refreshToken,
            })
            const tokenStore = config.tokenStore
            if (!tokenStore) {
              throw error
            }
            persistAuthTokens(tokenStore, data)
          })()
            .catch(() => {
              config.tokenStore?.clear()
              config.onUnauthorized?.({ error, status })
              throw error
            })
            .finally(() => {
              refreshPromise = null
            })
        }
        try {
          await refreshPromise
          ;(originalRequest as { _retry?: boolean })._retry = true
          return instance.request(originalRequest)
        } catch {
          return Promise.reject(error)
        }
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
