// Lets a release build talk plain http to its API — only ever added by
// src/app-variant.js when EXPO_PUBLIC_API_URL is http:// (a demo APK pointed
// at a laptop on the local Wi-Fi). Android 9+ blocks cleartext in release
// builds by default, and the request then fails as «Нет подключения к
// интернету». Store builds use https and never get this.
const { withAndroidManifest } = require("expo/config-plugins")

module.exports = function withAndroidCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    if (app) app.$["android:usesCleartextTraffic"] = "true"
    return cfg
  })
}
