import { HttpClient } from "./http-client"
import { TokenStore } from "./token-store"

export type LanguageCode = "EN" | "RU" | "KZ" | "ZH"

export interface SendAuthCodeRequest {
  email: string
  language?: LanguageCode
  /**
   * Workspace key the client wants to join (e.g. "bjj-academy"). Server
   * uses it to auto-place a fresh sign-up into that workspace as INVITED.
   */
  workspaceKey?: string
}

// Same answer whether or not the account already existed.
export interface SendAuthCodeResponse {
  sent: true
}

export interface SignInRequest {
  email: string
  code: string
}

export interface SignInResponse {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface RefreshTokenRequest {
  refreshToken: string
}

export interface RefreshTokenResponse {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export const createAuthApi = (client: HttpClient) => ({
  sendAuthCode: (payload: SendAuthCodeRequest) =>
    client.request<SendAuthCodeResponse, SendAuthCodeRequest>({
      method: "post",
      url: "/send-auth-code",
      data: payload,
    }),
  signIn: (payload: SignInRequest) =>
    client.request<SignInResponse, SignInRequest>({
      method: "post",
      url: "/sign-in",
      data: payload,
    }),
  refreshToken: (payload: RefreshTokenRequest) =>
    client.request<RefreshTokenResponse, RefreshTokenRequest>({
      method: "post",
      url: "/refresh-token",
      data: payload,
    }),
})

export const persistAuthTokens = (
  tokenStore: TokenStore,
  response: Pick<SignInResponse, "accessToken" | "refreshToken" | "expiresAt" | "userId">
): void => {
  tokenStore.setAccessToken(response.accessToken)
  tokenStore.setRefreshToken(response.refreshToken)
  tokenStore.setExpiresAt(response.expiresAt)
  tokenStore.setUserId(response.userId)
}
