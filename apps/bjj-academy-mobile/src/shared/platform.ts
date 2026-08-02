import { Platform } from "react-native"

// True only on the browser PWA build (react-native-web).
export const isWeb = Platform.OS === "web"

// Offline video downloads are backed by expo-file-system, which has no useful
// web implementation — a browser can't stash videos in app storage the way a
// native install can. So on web we hide every "download for offline" affordance
// rather than surface buttons that hang or error when pressed.
export const supportsOfflineDownload = Platform.OS !== "web"
