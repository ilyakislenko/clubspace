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
        const refreshToken = config.tokenStore.getRefreshToken()
        if (refreshToken) {
          try {
            const { data } = await instance.post('/refresh-token', { refreshToken })
            persistAuthTokens(config.tokenStore, data)
            return instance.request(error.config!)
          } catch {
            config.tokenStore.clear()
            config.onUnauthorized?.({ error, status })
          }
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
