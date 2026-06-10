export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TokenStore {
  getAccessToken(): string | null
  setAccessToken(token: string): void
  getRefreshToken(): string | null
  setRefreshToken(token: string): void
  getExpiresAt(): number | null
  setExpiresAt(expiresAt: number): void
  getUserId(): string | null
  setUserId(userId: string): void
  /**
   * May be sync (memory/localStorage) or async (SecureStore). Callers that
   * need to know the secret is gone from disk before navigating must await.
   */
  clear(): void | Promise<void>
}

export interface TokenStoreKeys {
  accessToken: string
  refreshToken: string
  expiresAt: string
  userId: string
}

const defaultKeys: TokenStoreKeys = {
  accessToken: "accessToken",
  refreshToken: "refreshToken",
  expiresAt: "expiresAt",
  userId: "userId",
}

export const createMemoryTokenStore = (): TokenStore => {
  let accessToken: string | null = null
  let refreshToken: string | null = null
  let expiresAt: number | null = null
  let userId: string | null = null

  return {
    getAccessToken: () => accessToken,
    setAccessToken: (token) => {
      accessToken = token
    },
    getRefreshToken: () => refreshToken,
    setRefreshToken: (token) => {
      refreshToken = token
    },
    getExpiresAt: () => expiresAt,
    setExpiresAt: (value) => {
      expiresAt = value
    },
    getUserId: () => userId,
    setUserId: (value) => {
      userId = value
    },
    clear: () => {
      accessToken = null
      refreshToken = null
    },
  }
}

export const createStorageTokenStore = (
  storage: KeyValueStorage,
  keys: TokenStoreKeys = defaultKeys
): TokenStore => ({
  getAccessToken: () => storage.getItem(keys.accessToken),
  setAccessToken: (token) => storage.setItem(keys.accessToken, token),
  getRefreshToken: () => storage.getItem(keys.refreshToken),
  setRefreshToken: (token) => storage.setItem(keys.refreshToken, token),
  getExpiresAt: () => storage.getItem(keys.expiresAt) ? parseInt(storage.getItem(keys.expiresAt)!) : null,
  setExpiresAt: (expiresAt) => storage.setItem(keys.expiresAt, expiresAt.toString()),
  getUserId: () => storage.getItem(keys.userId),
  setUserId: (userId) => storage.setItem(keys.userId, userId),
  clear: () => {
    storage.removeItem(keys.accessToken)
    storage.removeItem(keys.refreshToken)
    storage.removeItem(keys.expiresAt)
    storage.removeItem(keys.userId)
  },
})
