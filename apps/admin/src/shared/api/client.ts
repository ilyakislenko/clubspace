import {
  createAuthApi,
  createAxiosHttpClient,
  createMemoryTokenStore,
  createStorageTokenStore,
  persistAuthTokens,
  TokenStore,
} from "@bjj-academy/api-client"

import { environment } from "../../environments/environment"

let tokenStore: TokenStore | null = null
let authApi: ReturnType<typeof createAuthApi> | null = null

const getTokenStore = (): TokenStore => {
  if (!tokenStore) {
    tokenStore =
      typeof window !== "undefined"
        ? createStorageTokenStore(window.localStorage)
        : createMemoryTokenStore()
  }

  return tokenStore
}

export const getAuthApi = () => {
  if (!authApi) {
    const { client } = createAxiosHttpClient({
      baseURL: environment.apiBaseUrl,
      tokenStore: getTokenStore(),
      onUnauthorized: () => {
        if (typeof window !== "undefined") {
          window.location.assign("/sign-in")
        }
      },
    })
    authApi = createAuthApi(client)
  }

  return authApi
}

export const storeAuthTokens = (
  response: Parameters<typeof persistAuthTokens>[1]
) => {
  persistAuthTokens(getTokenStore(), response)
}
