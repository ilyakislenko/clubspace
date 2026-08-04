import { Platform } from "react-native"

// True only on the browser PWA build (react-native-web).
export const isWeb = Platform.OS === "web"

// Offline video downloads are backed by expo-file-system, which has no useful
// web implementation — a browser can't stash videos in app storage the way a
// native install can. So on web we hide every "download for offline" affordance
// rather than surface buttons that hang or error when pressed.
export const supportsOfflineDownload = Platform.OS !== "web"

// Push is Expo/FCM, i.e. native-only here. On web the expo-notifications calls
// either throw outright (`getLastNotificationResponseAsync`) or ask the browser
// for a notification permission this app has nothing wired up to deliver on.
// Members on the PWA still get everything in the in-app inbox.
export const supportsPushNotifications = Platform.OS !== "web"
