import { CameraView } from "expo-camera"
import { useEffect, useState } from "react"

/**
 * Whether this device can run the in-app QR scanner. Native builds have a
 * camera; a browser needs getUserMedia (a secure context, a camera present),
 * so the PWA hides the scan button rather than showing a broken one. False
 * until the check resolves.
 */
export function useQrScanAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
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
