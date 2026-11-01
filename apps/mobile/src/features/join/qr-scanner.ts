import { joinCodeFromQr } from "./qr-join"

export const NOT_A_CLUB_QR = "Это не QR-код клуба"

/** The subset of expo-camera's PermissionResponse the screen reads. */
export type CameraPermission = { granted: boolean; canAskAgain: boolean }

export type ScannerView = "checking" | "ask" | "denied" | "camera"

/** What the scanner screen shows for the camera permission state. */
export const scannerView = (
  permission: CameraPermission | null,
): ScannerView =>
  permission === null
    ? "checking"
    : permission.granted
      ? "camera"
      : permission.canAskAgain
        ? "ask"
        : "denied"

// The camera reports the same code many times a second while it is in view.
const REPEAT_MS = 2000

/**
 * Turns the camera's stream of scans into at most one `onCode` (the first
 * club code; everything after it is ignored) and one `onRejected` per
 * distinct foreign payload every couple of seconds.
 */
export const createScanHandler = ({
  onCode,
  onRejected,
  now = Date.now,
}: {
  onCode: (code: string) => void
  onRejected: () => void
  now?: () => number
}) => {
  let done = false
  let last: { data: string; at: number } | null = null
  return (data: string) => {
    if (done) return
    const at = now()
    if (last && last.data === data && at - last.at < REPEAT_MS) return
    last = { data, at }
    const code = joinCodeFromQr(data)
    if (code === null) {
      onRejected()
      return
    }
    done = true
    onCode(code)
  }
}

/**
 * Into the regular join-by-code flow, as if the code was typed: back to the
 * join screen below (or in place of the scanner when opened from elsewhere).
 */
export const openJoinFromScan = (
  navigation: {
    popTo: (name: "JoinClub", params: { code: string }) => void
  },
  code: string,
) => navigation.popTo("JoinClub", { code })
