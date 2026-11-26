// The whole Expo config of the mobile app, derived from the build env. Read by
// app.config.js (native + web builds), scripts/sync-web-assets.mjs (PWA icons
// and manifest) and scripts/check-release-env.mjs. Plain CommonJS with no
// imports so all three — and jest — can load it as is.
//
// Two variants, picked by EXPO_PUBLIC_CLUB_PICKER exactly like the runtime
// (src/shared/env.ts):
//
// - canonical (EXPO_PUBLIC_CLUB_PICKER=true; eas profiles preview, production,
//   store): the neutral «ClubSpace» app, `com.clubspace.app`. No club is baked
//   in; a member joins clubs by code, link or QR. This is the one listing on
//   App Store / Google Play / RuStore (Apple 4.2.6 "picker" model). Identity
//   env is ignored here, so a stray EXPO_PUBLIC_BUNDLE_ID can't re-brand it.
// - branded (anything else; eas profiles branded, branded-store): one club's
//   own app, published from that club's developer account. Name, bundle id,
//   scheme, slug, colour and icons come from env; the release guard refuses a
//   branded build that still carries the canonical identity. Unset values fall
//   back to the canonical ones so `expo start` works without any env.
//
// Both claim https://<EXPO_PUBLIC_WEB_URL host>/join/* (universal links / App
// Links), so a club's invite link or QR code opens the app with the code in.

const CANONICAL = {
  name: "ClubSpace",
  bundleId: "com.clubspace.app",
  scheme: "clubspace",
  // The EAS project key: the Android keystore and the remote version counter
  // live under it. Renaming it starts a new EAS project and a new keystore,
  // and installed apps could no longer be updated — so it keeps its old name.
  slug: "grappling-academy-mobile",
  assetsDir: "./assets/images",
}

// File names expected inside APP_ASSETS_DIR (a branded build's own artwork).
const ASSET_FILES = {
  icon: "icon.png",
  adaptiveIcon: "adaptive-icon.png",
  splash: "splash-icon.png",
  favicon: "favicon.png",
}

// Mirrors `colors.accent` of the presets in src/shared/brand.ts (an unknown
// brand resolves to `custom` there too); app-variant.spec.ts keeps them equal.
const BRAND_ACCENT = {
  grappling: "#5b58d9",
  fitness: "#0ea5e9",
  yoga: "#7c3aed",
  clubspace: "#5b58d9",
  custom: "#0f172a",
}

// The app's default light background (themes.ts), used behind the splash
// art and by the installed PWA before the bundle paints.
const APP_BACKGROUND = "#faf9fb"

// The iOS camera prompt (NSCameraUsageDescription). Both scanners ask: a
// member joining by the club's QR, a coach scanning member cards at the door.
const CAMERA_PERMISSION =
  "Камера нужна, чтобы сканировать QR-коды: код клуба и карты учеников"

// The iOS photo library prompt (NSPhotoLibraryUsageDescription).
const PHOTOS_PERMISSION =
  "Доступ к галерее нужен, чтобы отправить своё видео на разбор"

// EAS Update (OTA): a JS/asset fix published with scripts/eas-update.mjs
// reaches installed apps without a store release. On every cold start the app
// asks the update server and waits at most this long; on a slow or dead
// network it starts the update it already has and finishes the download in
// the background, so the new one runs from the next cold start.
const UPDATE_CHECK_TIMEOUT_MS = 3000

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

const trimmed = (value) => {
  const out = typeof value === "string" ? value.trim() : ""
  return out.length > 0 ? out : null
}

function hostOf(url) {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

// Expo resolves relative asset paths against the project root and wants them
// spelled "./…"; an absolute path (an EAS file variable) is kept as is.
function assetsDirOf(raw) {
  const dir = trimmed(raw)
  if (!dir) return CANONICAL.assetsDir
  const clean = dir.replace(/\/+$/, "")
  return /^(\/|\.\.?\/)/.test(clean) ? clean : `./${clean}`
}

function resolveAppIdentity(env) {
  const brandRaw = (trimmed(env.EXPO_PUBLIC_BRAND) ?? "").toLowerCase()
  const brand = brandRaw in BRAND_ACCENT ? brandRaw : "custom"
  const webHost = hostOf(env.EXPO_PUBLIC_WEB_URL)

  if (env.EXPO_PUBLIC_CLUB_PICKER === "true") {
    return {
      variant: "canonical",
      name: CANONICAL.name,
      bundleId: CANONICAL.bundleId,
      scheme: CANONICAL.scheme,
      slug: CANONICAL.slug,
      assetsDir: CANONICAL.assetsDir,
      accentColor: BRAND_ACCENT[brand],
      webHost,
    }
  }

  const bundleId = trimmed(env.EXPO_PUBLIC_BUNDLE_ID)
  const color = trimmed(env.EXPO_PUBLIC_APP_COLOR)
  return {
    variant: "branded",
    name: trimmed(env.EXPO_PUBLIC_APP_NAME) ?? CANONICAL.name,
    bundleId: bundleId ?? CANONICAL.bundleId,
    // Never the canonical `clubspace` scheme once the club has its own id:
    // with both apps installed, clubspace:// links must keep opening ClubSpace.
    scheme:
      trimmed(env.EXPO_PUBLIC_APP_SCHEME) ??
      (bundleId ? bundleId.toLowerCase() : CANONICAL.scheme),
    slug:
      trimmed(env.EXPO_PUBLIC_APP_SLUG) ??
      (bundleId
        ? bundleId.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        : CANONICAL.slug),
    assetsDir: assetsDirOf(env.APP_ASSETS_DIR),
    accentColor:
      color && HEX_COLOR.test(color) ? color : BRAND_ACCENT[brand],
    webHost,
  }
}

function joinLinkClaims(host) {
  if (!host) return { ios: {}, android: {} }
  return {
    ios: { associatedDomains: [`applinks:${host}`] },
    android: {
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host, pathPrefix: "/join/" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
  }
}

// EAS Update, only for a build tied to an EAS project (EAS_PROJECT_ID): the
// update server lives under the project id. Without one — `expo start`, the
// PWA, a local demo build — updates are off and the app runs the bundle it
// was built with.
//
// Runtime version = fingerprint, not appVersion: `version` stays 1.0.0 until
// the first store release, so under appVersion every build would share one
// runtime, and a JS update that needs a newly added native module (or a
// permission, a plugin option) would land on binaries without it and crash.
// The fingerprint hashes the native side — this resolved config, the native
// packages, config plugins — so any native change makes a new runtime and an
// update reaches only the builds it fits. The config depends on the build env
// (variant, brand colour, link host, http API), which is why an update is
// published with its profile's env: scripts/eas-update.mjs.
//
// No channel here: EAS Build writes the eas.json profile's `channel` into the
// binary (preview → preview, production/store → production, branded/
// branded-store → branded; development has none and takes no updates). A
// per-profile value in this config would also change the fingerprint, which
// `eas update` computes without a build profile. A club's branded app lives
// in its own EAS project (own slug, project id and update URL), so ClubSpace
// updates never reach it, and the other way round.
function updatesConfig(projectId) {
  if (!projectId) return { updates: { enabled: false } }
  return {
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: UPDATE_CHECK_TIMEOUT_MS,
    },
  }
}

function resolveAppConfig(env) {
  const id = resolveAppIdentity(env)
  const asset = (file) => `${id.assetsDir}/${file}`
  const links = joinLinkClaims(id.webHost)
  const projectId = trimmed(env.EAS_PROJECT_ID)
  const googleServicesFile = trimmed(env.GOOGLE_SERVICES_FILE)
  // A demo APK aimed at a laptop on the LAN (http://192.168.…:3000) needs
  // cleartext allowed; an https API never gets it.
  const httpApi = /^http:\/\//i.test(trimmed(env.EXPO_PUBLIC_API_URL) ?? "")

  return {
    name: id.name,
    slug: id.slug,
    version: "1.0.0",
    orientation: "portrait",
    icon: asset(ASSET_FILES.icon),
    scheme: [id.scheme],
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ...updatesConfig(projectId),
    ios: {
      supportsTablet: true,
      bundleIdentifier: id.bundleId,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // The app speaks Russian only. Without this iOS draws its own UI in
        // the app — the text edit menu («Paste», «AutoFill»), the paste and
        // permission prompts, share sheet, pickers — in English.
        CFBundleDevelopmentRegion: "ru",
        CFBundleLocalizations: ["ru"],
      },
      // App Store privacy manifest (required since May 2024). Reasons are the
      // ones Expo documents for its own modules: CA92.1 — UserDefaults read
      // only by the app itself (AsyncStorage/SecureStore); C617.1 — file
      // timestamps of files inside the app container (expo-file-system, the
      // offline video cache). No tracking, no tracking domains.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
            NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
          },
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
            NSPrivacyAccessedAPITypeReasons: ["C617.1"],
          },
        ],
      },
      ...links.ios,
    },
    android: {
      package: id.bundleId,
      // The foreground is the white mark on transparent; the brand accent
      // behind it matches the iOS icon.
      adaptiveIcon: {
        foregroundImage: asset(ASSET_FILES.adaptiveIcon),
        backgroundColor: id.accentColor,
      },
      // FCM credentials for Android push (an EAS file variable on the worker).
      ...(googleServicesFile ? { googleServicesFile } : {}),
      blockedPermissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.USE_BIOMETRIC",
        "android.permission.USE_FINGERPRINT",
      ],
      ...links.android,
    },
    web: {
      bundler: "metro",
      favicon: asset(ASSET_FILES.favicon),
      lang: "ru",
      description: "Курсы, расписание, посещаемость и абонемент вашего клуба.",
    },
    extra: {
      _comment:
        "These values are a DEV-ONLY fallback for `expo start` when no .env file is present. Production builds source EXPO_PUBLIC_* from eas.json build.<profile>.env, which Expo inlines into process.env at bundle time and takes priority over `extra` (see src/shared/env.ts).",
      EXPO_PUBLIC_API_URL: "http://localhost:3000",
      EXPO_PUBLIC_BRAND: "clubspace",
      EXPO_PUBLIC_CLUB_PICKER: "true",
      // Expo push tokens are issued per EAS project
      // (features/notifications/push-registration.ts reads it from here).
      ...(projectId ? { eas: { projectId } } : {}),
    },
    plugins: [
      [
        "expo-splash-screen",
        {
          image: asset(ASSET_FILES.splash),
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
      // Tokens only, no biometric unlock: without this the plugin writes an
      // English NSFaceIDUsageDescription for a permission the app never asks.
      ["expo-secure-store", { faceIDPermission: false }],
      "expo-video",
      // Drill cues play while the screen is open. No background playback, so
      // iOS gets no `audio` UIBackgroundModes (App Review 2.5.4) and Android
      // no media-playback foreground service.
      [
        "expo-audio",
        {
          microphonePermission: false,
          recordAudioAndroid: false,
          enableBackgroundPlayback: false,
        },
      ],
      ["expo-notifications", { color: id.accentColor }],
      // The in-app QR scanner (features/join/ScanJoinQrScreen.tsx). Photo
      // only: no microphone, so Android never asks for RECORD_AUDIO.
      [
        "expo-camera",
        {
          cameraPermission: CAMERA_PERMISSION,
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      // «Разбор видео»: the member picks a clip from the gallery. Library
      // only — no camera or microphone strings for permissions never asked.
      [
        "expo-image-picker",
        {
          photosPermission: PHOTOS_PERMISSION,
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      // Brand accent and sentence-case buttons in native Android dialogs.
      ["./plugins/with-android-brand-dialogs", { color: id.accentColor }],
      ...(httpApi ? ["./plugins/with-android-cleartext"] : []),
    ],
  }
}

// The installable PWA's manifest, per brand. Written into public/ by
// scripts/sync-web-assets.mjs so `expo start --web` and the export agree.
function buildWebManifest(env) {
  const id = resolveAppIdentity(env)
  return {
    name: id.name,
    short_name: id.name,
    description: "Курсы, расписание, посещаемость и абонемент вашего клуба.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: APP_BACKGROUND,
    theme_color: id.accentColor,
    lang: "ru",
    dir: "ltr",
    categories: ["sports", "education", "health"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}

module.exports = {
  CANONICAL,
  ASSET_FILES,
  BRAND_ACCENT,
  resolveAppIdentity,
  resolveAppConfig,
  buildWebManifest,
}
