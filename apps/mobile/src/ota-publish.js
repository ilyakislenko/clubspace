// What scripts/eas-update.mjs publishes for one eas.json build profile: its
// channel, its EAS environment and the env its bundle is made with. Pure —
// eas.json, the env and the file system are passed in — so jest covers it;
// CommonJS for the same reason as app-variant.js.
//
// Plain `eas update` ignores `build.<profile>.env` of eas.json. But
// EXPO_PUBLIC_* are inlined into the bundle (an update without them talks to
// the dev fallback API), and the env shapes the app config whose fingerprint
// is the runtime version (src/app-variant.js) — an update made with another
// env never matches the builds of that profile. So the publisher's shell
// loses every build-only variable, and the profile's eas.json env goes on top
// of what is left, as on the EAS worker; `eas update --environment` then adds
// the project's plain and sensitive EAS variables (a branded app's identity).
//
// File variables are the exception: `eas update` never downloads them, yet
// the Android fingerprint hashes the content of google-services.json. So
// GOOGLE_SERVICES_FILE comes from the publisher — a local copy of the very
// file the builds got — and a release publish that includes Android refuses
// to run without it.
const {
  BRANDED_PROFILES,
  CANONICAL_PROFILES,
  releaseUrlErrors,
} = require("./release-env")

// Never taken from the publisher's shell: on the EAS worker they come only
// from eas.json or the EAS environment.
const BUILD_ONLY_ENV = /^(EXPO_PUBLIC_|APP_ASSETS_DIR$)/

/**
 * The `--platform` of `eas update` flags (`--platform ios`, `-p=android`…);
 * `all` when absent, like eas-cli.
 *
 * @param {string[]} args
 * @returns {string}
 */
function platformOf(args) {
  for (let i = 0; i < args.length; i++) {
    const match = /^(?:--platform|-p)(?:=(.*))?$/.exec(args[i])
    if (match) return match[1] ?? args[i + 1] ?? "all"
  }
  return "all"
}

/**
 * A build profile with its `extends` chain applied, `env` merged key by key
 * like EAS does.
 *
 * @param {{ build?: Record<string, Record<string, any>> }} easJson
 * @param {string} name
 * @returns {Record<string, any>}
 */
function resolveBuildProfile(easJson, name, seen = []) {
  const profile = easJson.build?.[name]
  if (!profile) throw new Error(`eas.json has no build profile "${name}"`)
  if (seen.includes(name)) {
    throw new Error(`eas.json profiles extend in a loop: ${[...seen, name].join(" → ")}`)
  }
  const base = profile.extends
    ? resolveBuildProfile(easJson, profile.extends, [...seen, name])
    : {}
  const { extends: _extends, ...own } = profile
  return { ...base, ...own, env: { ...base.env, ...own.env } }
}

/**
 * @param {{
 *   easJson: { build?: Record<string, Record<string, any>> },
 *   profile: string,
 *   args: string[],
 *   env: Record<string, string | undefined>,
 *   fileExists: (path: string) => boolean,
 * }} input  `args`: the extra `eas update` flags. Paths are relative to
 *           apps/mobile, or absolute.
 * @returns {{ channel: string, environment: string, env: Record<string, string> }}
 * @throws when the profile's builds take no updates, the project is unknown,
 *         or the env would bundle an update no build of the profile matches.
 */
function resolveOtaPublish({ easJson, profile, args, env, fileExists }) {
  const build = resolveBuildProfile(easJson, profile)
  if (!build.channel) {
    throw new Error(
      `Profile "${profile}" has no channel: its builds take no OTA updates.`,
    )
  }
  if (!build.environment) {
    throw new Error(
      `Profile "${profile}" has no EAS environment ("environment" in eas.json).`,
    )
  }
  if ((env.EAS_PROJECT_ID ?? "").trim() === "") {
    throw new Error(
      "EAS_PROJECT_ID is not set: export the id of the app's EAS project " +
        "(the one its builds were made in), then run again.",
    )
  }

  const kept = Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => value !== undefined && !BUILD_ONLY_ENV.test(name),
    ),
  )
  const out = { ...kept, ...build.env }

  // The same URLs the build guard (check-release-env.mjs) demands: eas.json
  // must be as it was at build time, with set-mobile-target.sh's values.
  if (CANONICAL_PROFILES.includes(profile)) {
    const errors = releaseUrlErrors(out)
    if (errors.length > 0) {
      throw new Error(
        `${errors.join("; ")}. Publish with eas.json as it was when the ` +
          "builds were made (scripts/set-mobile-target.sh).",
      )
    }
  }

  const googleServices = (out.GOOGLE_SERVICES_FILE ?? "").trim()
  const release = [...CANONICAL_PROFILES, ...BRANDED_PROFILES].includes(profile)
  if (googleServices && !fileExists(googleServices)) {
    throw new Error(`GOOGLE_SERVICES_FILE points at a missing file: ${googleServices}`)
  }
  if (!googleServices && release && platformOf(args) !== "ios") {
    throw new Error(
      "GOOGLE_SERVICES_FILE is not set: point it at a local copy of the " +
        "google-services.json the Android builds were made with (the EAS file " +
        "variable) — without it no Android build matches the update. Or " +
        "publish for iOS only: --platform ios.",
    )
  }

  return { channel: build.channel, environment: build.environment, env: out }
}

module.exports = { platformOf, resolveBuildProfile, resolveOtaPublish }
