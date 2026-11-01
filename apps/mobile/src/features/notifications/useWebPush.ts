import { useCallback, useEffect, useState } from "react"

import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { isWeb } from "../../shared/platform"
import {
  disableWebPush,
  enableWebPush,
  getWebPushState,
  type WebPushState,
} from "./web-push"

/**
 * The browser's notification state for the Settings switch and the Home
 * banner. `null` while loading and always on native (Expo push lives
 * elsewhere). `enable` must be wired to a tap — it may prompt.
 */
export function useWebPush() {
  const { showToast } = useToast()
  const [state, setState] = useState<WebPushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isWeb) return
    void getWebPushState()
      .then(setState)
      .catch(() => setState("unsupported"))
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    try {
      const next = await enableWebPush()
      setState(next)
      if (next === "enabled") showToast("Уведомления включены", "success")
      if (next === "denied") {
        showToast("Браузер запретил уведомления для этого сайта", "error")
      }
    } catch (e) {
      showToast(errorMessage(e, "Не удалось включить уведомления."), "error")
    } finally {
      setBusy(false)
    }
  }, [showToast])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      await disableWebPush()
      setState(await getWebPushState())
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, busy, enable, disable }
}

export const IOS_INSTALL_HINT =
  "На iPhone и iPad уведомления приходят, только если приложение добавлено " +
  "на экран «Домой» (iOS 16.4 и новее): в Safari нажмите «Поделиться» → " +
  "«На экран „Домой“» и откройте приложение с иконки."
