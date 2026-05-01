import * as SecureStore from "expo-secure-store"

import type { KeyValueStorage, TokenStore } from "@bjj-academy/api-client"

/**
 * SecureStore is async, but the api-client TokenStore interface is synchronous.
 * We mirror values into an in-memory cache that is hydrated once on startup
 * (via `hydrateMobileTokenStore`) and kept in sync on every write.
 */

const MEMORY: Record<string, string | null> = {
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  userId: null,
}

const SECURE_KEYS = Object.keys(MEMORY)

const memoryStorage: KeyValueStorage = {
  getItem: (key) => MEMORY[key] ?? null,
  setItem: (key, value) => {
    MEMORY[key] = value
    SecureStore.setItemAsync(key, value).catch(() => undefined)
  },
  removeItem: (key) => {
    MEMORY[key] = null
    SecureStore.deleteItemAsync(key).catch(() => undefined)
  },
}

export const hydrateMobileTokenStore = async () => {
  await Promise.all(
    SECURE_KEYS.map(async (key) => {
      try {
        const value = await SecureStore.getItemAsync(key)
        MEMORY[key] = value
      } catch {
        MEMORY[key] = null
      }
    }),
  )
}

export const createMobileTokenStore = (): TokenStore => ({
  getAccessToken: () => memoryStorage.getItem("accessToken"),
  setAccessToken: (token) => memoryStorage.setItem("accessToken", token),
  getRefreshToken: () => memoryStorage.getItem("refreshToken"),
  setRefreshToken: (token) => memoryStorage.setItem("refreshToken", token),
  getExpiresAt: () => {
    const raw = memoryStorage.getItem("expiresAt")
    return raw ? Number.parseInt(raw, 10) : null
  },
  setExpiresAt: (value) =>
    memoryStorage.setItem("expiresAt", value.toString()),
  getUserId: () => memoryStorage.getItem("userId"),
  setUserId: (value) => memoryStorage.setItem("userId", value),
  clear: () => {
    SECURE_KEYS.forEach((key) => memoryStorage.removeItem(key))
  },
})
