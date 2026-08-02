import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

import type { TokenStore } from "@bjj-academy/api-client"

// expo-secure-store has no web backend, so on web we persist to localStorage —
// otherwise tokens live only in memory and every reload forces a re-login.
// `globalThis.localStorage` is typed minimally so this file needs no DOM lib.
const isWeb = Platform.OS === "web"

type WebStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
const webStore = (): WebStorage | undefined =>
  (globalThis as { localStorage?: WebStorage }).localStorage

const persistItem = (key: string, value: string): Promise<void> => {
  if (isWeb) {
    try {
      webStore()?.setItem(key, value)
    } catch {
      /* private mode / storage disabled — degrade to in-memory only */
    }
    return Promise.resolve()
  }
  return SecureStore.setItemAsync(key, value)
}

const removeItem = (key: string): Promise<void> => {
  if (isWeb) {
    try {
      webStore()?.removeItem(key)
    } catch {
      /* ignore */
    }
    return Promise.resolve()
  }
  return SecureStore.deleteItemAsync(key)
}

const readItem = (key: string): Promise<string | null> => {
  if (isWeb) {
    try {
      return Promise.resolve(webStore()?.getItem(key) ?? null)
    } catch {
      return Promise.resolve(null)
    }
  }
  return SecureStore.getItemAsync(key)
}

/**
 * SecureStore is async, but the api-client TokenStore interface is mostly
 * synchronous (getters/setters). We mirror values into an in-memory cache
 * that is hydrated once on startup (via `hydrateMobileTokenStore`) and kept
 * in sync on every write.
 *
 * Writes to SecureStore are serialized per key via a small promise chain so
 * a sign-out delete cannot resolve before a refresh-token write that was
 * issued first. `clear()` awaits the chain plus the new deletes so the
 * sign-out flow can await it and be sure the keychain is wiped before
 * routing to the sign-in screen.
 */

const MEMORY: Record<string, string | null> = {
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  userId: null,
}

const SECURE_KEYS = Object.keys(MEMORY)

// Per-key promise chain. Each enqueued write waits for the previous one for
// the same key to settle before issuing its SecureStore call. We do NOT
// reject the chain on error — one failed write must not poison subsequent
// writes.
const WRITE_CHAIN: Record<string, Promise<void>> = {}

const enqueueWrite = (key: string, op: () => Promise<void>): Promise<void> => {
  const previous = WRITE_CHAIN[key] ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(op)
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[token-store] SecureStore I/O failed for "${key}"`,
        error,
      )
    })
  WRITE_CHAIN[key] = next
  return next
}

const writeSecure = (key: string, value: string) =>
  enqueueWrite(key, () => persistItem(key, value))

const deleteSecure = (key: string) =>
  enqueueWrite(key, () => removeItem(key))

const setMemoryAndPersist = (key: string, value: string) => {
  MEMORY[key] = value
  void writeSecure(key, value)
}

const clearMemoryAndPersist = (key: string): Promise<void> => {
  MEMORY[key] = null
  return deleteSecure(key)
}

export const hydrateMobileTokenStore = async () => {
  await Promise.all(
    SECURE_KEYS.map(async (key) => {
      try {
        const value = await readItem(key)
        MEMORY[key] = value
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[token-store] token read failed for "${key}"`,
          error,
        )
        MEMORY[key] = null
      }
    }),
  )
}

export const createMobileTokenStore = (): TokenStore => ({
  getAccessToken: () => MEMORY.accessToken ?? null,
  setAccessToken: (token) => setMemoryAndPersist("accessToken", token),
  getRefreshToken: () => MEMORY.refreshToken ?? null,
  setRefreshToken: (token) => setMemoryAndPersist("refreshToken", token),
  getExpiresAt: () => {
    const raw = MEMORY.expiresAt
    return raw ? Number.parseInt(raw, 10) : null
  },
  setExpiresAt: (value) =>
    setMemoryAndPersist("expiresAt", value.toString()),
  getUserId: () => MEMORY.userId ?? null,
  setUserId: (value) => setMemoryAndPersist("userId", value),
  clear: async () => {
    // Drop memory immediately so any synchronous reads after clear() see
    // no token, then await every queued write + the deletes so the caller
    // can navigate after this resolves without leaving a refresh token on
    // disk.
    await Promise.all(SECURE_KEYS.map((key) => clearMemoryAndPersist(key)))
  },
})
