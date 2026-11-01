import { Platform } from "react-native"

// True only on the browser PWA build (react-native-web).
export const isWeb = Platform.OS === "web"

// What a browser needs to keep and play a lesson offline: Cache Storage for
// the files (secure contexts only) and Media Source Extensions — or iOS 17.1+'s
// ManagedMediaSource — for hls.js to play the stored H.264/AAC segments.
// Older iPhones (Safari before 17.1) have neither MSE nor a way to feed local
// segments to the native player, so they get no download button at all.
const browserCanPlayOffline = (): boolean => {
  // Feature detection: none of these exist on every target, so read them
  // as optional rather than trusting the DOM lib's always-present types.
  const g = globalThis as {
    isSecureContext?: boolean
    caches?: unknown
    MediaSource?: { isTypeSupported?: (type: string) => boolean }
    ManagedMediaSource?: { isTypeSupported?: (type: string) => boolean }
  }
  if (!g.isSecureContext || !g.caches) return false
  const source = g.ManagedMediaSource ?? g.MediaSource
  return Boolean(
    source?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
  )
}

// Native downloads one MP4 through expo-file-system; the web build stores the
// HLS rendition in Cache Storage (features/offline/offline-store.web.ts) when
// the browser can play it back.
export const supportsOfflineDownload = !isWeb || browserCanPlayOffline()

// Expo push (expo-notifications) is native-only. On web its calls either throw
// outright (`getLastNotificationResponseAsync`) or prompt outside a user
// gesture; the browser build uses Web Push instead
// (features/notifications/web-push.ts + public/service-worker.js).
export const supportsPushNotifications = Platform.OS !== "web"
