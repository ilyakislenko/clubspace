import { CameraView } from "expo-camera"
import { useEffect, useState } from "react"

import { isWeb } from "../../shared/platform"

/**
 * Whether this device can run the in-app QR scanner. Native builds have a
 * camera (`CameraView.isAvailableAsync` exists on web only — on iOS and
 * Android it throws, which hid every scan button on phones); a browser needs
 * getUserMedia (a secure context, a camera present), so the PWA hides the
 * scan button rather than showing a broken one. On web, false until the
 * check resolves.
 */
export function useQrScanAvailable(): boolean {
  const [available, setAvailable] = useState(!isWeb)
  useEffect(() => {
    if (!isWeb) return
    let alive = true
    CameraView.isAvailableAsync()
      .then((ok) => alive && setAvailable(ok))
      .catch(() => alive && setAvailable(false))
    return () => {
      alive = false
    }
  }, [])
  return available
}
