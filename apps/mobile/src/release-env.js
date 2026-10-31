// What scripts/check-release-env.mjs refuses (errors) or flags (warnings) for
// an EAS release build. Pure — the file system is passed in — so jest can cover
// every rule; CommonJS for the same reason as app-variant.js.
const {
  ASSET_FILES,
  CANONICAL,
  resolveAppIdentity,
} = require("./app-variant")

const CANONICAL_PROFILES = ["production", "store"]
const BRANDED_PROFILES = ["branded", "branded-store"]

// An Android application id (also used as the iOS bundle id): two or more
// dot-separated segments, each starting with a letter.
const APP_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/
const SCHEME = /^[a-z][a-z0-9+.-]*$/
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// A placeholder host, not merely a name containing "example": real domains
// like myexample.org must pass.
const isPlaceholderHost = (hostname) =>
  hostname === "localhost" ||
  hostname === "example.com" ||
  hostname.endsWith(".example.com") ||
  hostname === "example" ||
  hostname.endsWith(".example")

const isMissing = (value) =>
  (value ?? "").trim().length === 0 || value.startsWith("REPLACE_")

/**
 * @param {{
 *   profile: string | undefined,
 *   platform: string | undefined,
 *   env: Record<string, string | undefined>,
 *   fileExists: (path: string) => boolean,
 *   sameFile: (a: string, b: string) => boolean,
 * }} input  Paths are as written in the config: relative to apps/mobile, or
 *           absolute.
 * @returns {{ errors: string[], warnings: string[] } | null} null when the
 *          profile is not a release profile.
 */
function checkReleaseEnv({ profile, platform, env, fileExists, sameFile }) {
  const branded = BRANDED_PROFILES.includes(profile)
  if (!branded && !CANONICAL_PROFILES.includes(profile)) return null

  const errors = []
  const warnings = []

  for (const name of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_WEB_URL"]) {
    const value = env[name] ?? ""
    let hostname = ""
    try {
      hostname = new URL(value).hostname
    } catch {
      /* falls through to the https check below */
    }
    if (!value.startsWith("https://") || hostname === "") {
      errors.push(`${name} must be an https URL, got "${value}"`)
    } else if (isPlaceholderHost(hostname)) {
      errors.push(`${name} is a placeholder, got "${value}"`)
    }
  }
  const required = ["EXPO_PUBLIC_BRAND", "EXPO_PUBLIC_SUPPORT_EMAIL"]
  if (branded) {
    required.push(
      "EXPO_PUBLIC_WORKSPACE_KEY",
      "EXPO_PUBLIC_APP_NAME",
      "EXPO_PUBLIC_BUNDLE_ID",
      "APP_ASSETS_DIR",
    )
  }
  for (const name of required) {
    if (isMissing(env[name])) {
      errors.push(`${name} is missing or still a REPLACE_ placeholder`)
    }
  }

  const picker = env.EXPO_PUBLIC_CLUB_PICKER === "true"
  if (!branded && !picker) {
    errors.push(
      `EXPO_PUBLIC_CLUB_PICKER must be "true" for "${profile}": it ships the ` +
        "neutral ClubSpace app. A club's own app is the branded profile.",
    )
  }
  if (branded) {
    if (picker) {
      errors.push(
        `EXPO_PUBLIC_CLUB_PICKER must not be "true" for "${profile}": a ` +
          "branded app is locked to its club.",
      )
    }
    checkBrandedIdentity(env, { errors, fileExists, sameFile })
  }

  // Push: Expo issues push tokens per EAS project, and Android delivers them
  // through FCM. Neither breaks the build, so they are warnings.
  if (isMissing(env.EAS_PROJECT_ID)) {
    warnings.push(
      "EAS_PROJECT_ID is not set: extra.eas.projectId is missing, push tokens " +
        "fall back to the worker's project id (set it for local builds too).",
    )
  }
  const googleServices = (env.GOOGLE_SERVICES_FILE ?? "").trim()
  if (googleServices) {
    if (!fileExists(googleServices)) {
      errors.push(`GOOGLE_SERVICES_FILE points at a missing file: ${googleServices}`)
    }
  } else if (platform !== "ios") {
    warnings.push(
      "GOOGLE_SERVICES_FILE is not set: Android builds get no FCM config and " +
        "push notifications will not arrive.",
    )
  }

  return { errors, warnings }
}

function checkBrandedIdentity(env, { errors, fileExists, sameFile }) {
  const name = (env.EXPO_PUBLIC_APP_NAME ?? "").trim()
  if (name.toLowerCase() === CANONICAL.name.toLowerCase()) {
    errors.push(
      `EXPO_PUBLIC_APP_NAME is "${name}": a branded app carries the club's ` +
        "own name.",
    )
  }

  const bundleId = (env.EXPO_PUBLIC_BUNDLE_ID ?? "").trim()
  if (!isMissing(bundleId)) {
    if (!APP_ID.test(bundleId)) {
      errors.push(
        `EXPO_PUBLIC_BUNDLE_ID "${bundleId}" is not a valid app id ` +
          "(e.g. ru.myclub.app: letters, digits and _, dot-separated).",
      )
    } else if (
      bundleId === CANONICAL.bundleId ||
      bundleId.startsWith("com.clubspace.")
    ) {
      errors.push(
        `EXPO_PUBLIC_BUNDLE_ID "${bundleId}" belongs to ClubSpace. A branded ` +
          "app is published from the club's own developer account under its " +
          "own id (App Store 4.2.6, 4.3(a)); see docs/store-distribution.md.",
      )
    }
  }

  const scheme = (env.EXPO_PUBLIC_APP_SCHEME ?? "").trim()
  if (scheme && (!SCHEME.test(scheme) || scheme === CANONICAL.scheme)) {
    errors.push(
      `EXPO_PUBLIC_APP_SCHEME "${scheme}" must be a lowercase URL scheme ` +
        `other than "${CANONICAL.scheme}".`,
    )
  }

  const color = (env.EXPO_PUBLIC_APP_COLOR ?? "").trim()
  if (color && !HEX_COLOR.test(color)) {
    errors.push(`EXPO_PUBLIC_APP_COLOR "${color}" must be a #rgb or #rrggbb colour`)
  }

  if (isMissing(env.APP_ASSETS_DIR)) return
  const { assetsDir } = resolveAppIdentity(env)
  const missing = Object.values(ASSET_FILES).filter(
    (file) => !fileExists(`${assetsDir}/${file}`),
  )
  if (missing.length > 0) {
    errors.push(`APP_ASSETS_DIR ${assetsDir} lacks ${missing.join(", ")}`)
  } else if (
    sameFile(
      `${assetsDir}/${ASSET_FILES.icon}`,
      `${CANONICAL.assetsDir}/${ASSET_FILES.icon}`,
    )
  ) {
    errors.push(
      `APP_ASSETS_DIR ${assetsDir} carries the ClubSpace icon; a branded app ` +
        "needs the club's own artwork.",
    )
  }
}

module.exports = { checkReleaseEnv, CANONICAL_PROFILES, BRANDED_PROFILES }
