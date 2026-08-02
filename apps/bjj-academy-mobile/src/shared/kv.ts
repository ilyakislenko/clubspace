import * as SecureStore from "expo-secure-store"

import { isWeb } from "./platform"

// A tiny cross-platform string key-value store. On native it's the OS keychain
// (expo-secure-store); on the web PWA — where SecureStore has no backend — it
// falls back to localStorage so persisted state survives a reload. Without this,
// anything cached through SecureStore silently vanishes on web (e.g. the
// workspaces cache that keeps a valid session alive through a transient launch
// error). Best-effort: private-mode / disabled storage degrades to no-op rather
// than throwing.

type WebStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
const webStore = (): WebStorage | undefined =>
  (globalThis as { localStorage?: WebStorage }).localStorage

export const kvSet = async (key: string, value: string): Promise<void> => {
  if (isWeb) {
    try {
      webStore()?.setItem(key, value)
    } catch {
      /* storage disabled — nothing to persist */
    }
    return
  }
  await SecureStore.setItemAsync(key, value)
}

export const kvGet = async (key: string): Promise<string | null> => {
  if (isWeb) {
    try {
      return webStore()?.getItem(key) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(key)
}

export const kvDelete = async (key: string): Promise<void> => {
  if (isWeb) {
    try {
      webStore()?.removeItem(key)
    } catch {
      /* noop */
    }
    return
  }
  await SecureStore.deleteItemAsync(key)
}
