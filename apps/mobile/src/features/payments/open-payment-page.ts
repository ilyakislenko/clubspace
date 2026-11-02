import { Linking } from "react-native"

import { isWeb } from "../../shared/platform"

// On web the provider's page replaces the PWA in the same tab (a window opened
// after an awaited request is popup-blocked) and its return URL,
// /payment/<id>, brings the member back. Native hands it to the browser.
export const openPaymentPage = async (url: string) => {
  if (isWeb) {
    ;(globalThis as { location?: { assign?: (u: string) => void } }).location?.assign?.(url)
    return
  }
  await Linking.openURL(url)
}
