import * as Network from "expo-network"

import { getPreferences } from "../profile/preferences-store"

export type NetworkPolicyDecision =
  | { ok: true }
  | { ok: false; reason: "offline" | "cellular" }

/**
 * Check whether starting a download is allowed under the current network
 * policy: refuses when the device is offline, or when "Wi-Fi only" is on and
 * we're on cellular.
 */
export const canDownloadNow = async (): Promise<NetworkPolicyDecision> => {
  const prefs = await getPreferences()
  let state: Network.NetworkState
  try {
    state = await Network.getNetworkStateAsync()
  } catch {
    return { ok: true }
  }

  if (!state.isConnected || !state.isInternetReachable) {
    return { ok: false, reason: "offline" }
  }

  if (
    prefs.wifiOnlyDownloads &&
    state.type === Network.NetworkStateType.CELLULAR
  ) {
    return { ok: false, reason: "cellular" }
  }

  return { ok: true }
}

/**
 * Whether the device currently has a usable internet connection. Used to decide
 * whether to stream (preferred when online) or fall back to a local download.
 * Assumes online when the state can't be read, so a streaming attempt runs and
 * fails fast into the offline fallback rather than blocking on a false negative.
 */
export const isOnline = async (): Promise<boolean> => {
  try {
    const state = await Network.getNetworkStateAsync()
    return Boolean(state.isConnected && state.isInternetReachable)
  } catch {
    return true
  }
}

export const networkPolicyMessage = (
  reason: "offline" | "cellular",
): string => {
  if (reason === "offline") {
    return "Нет интернета. Подключитесь к сети и повторите."
  }
  return "В настройках включена загрузка только по Wi-Fi. Подключитесь к Wi-Fi."
}
