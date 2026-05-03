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

export const networkPolicyMessage = (
  reason: "offline" | "cellular",
): string => {
  if (reason === "offline") {
    return "Нет интернета. Подключитесь к сети и повторите."
  }
  return "В настройках включена загрузка только по Wi-Fi. Подключитесь к Wi-Fi."
}
