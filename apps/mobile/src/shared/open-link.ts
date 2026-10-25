import { Linking } from "react-native"

import { showAlert } from "./alert"
import { formatPhone } from "./format-ru"
import { isWebUrl, telUrl } from "./link-helpers"

/** Opens the dialer; says so instead of failing silently (no dialer, web). */
export const dialPhone = (phone: string) => {
  Linking.openURL(telUrl(phone)).catch(() =>
    showAlert("Не удалось открыть звонок", formatPhone(phone)),
  )
}

/** Opens a club-provided link — http(s) only; anything else is just reported. */
export const openWebLink = (url: string) => {
  const failed = () => showAlert("Не удалось открыть ссылку", url)
  if (!isWebUrl(url)) {
    failed()
    return
  }
  Linking.openURL(url).catch(failed)
}
