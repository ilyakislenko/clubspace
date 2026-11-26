// What scripts/eas-update.mjs publishes for one eas.json build profile: its
// channel, its EAS environment and the env its bundle is made with. Pure —
// eas.json and the env are passed in — so jest covers it; CommonJS for the
// same reason as app-variant.js.
//
// Plain `eas update` ignores `build.<profile>.env` of eas.json. But
// EXPO_PUBLIC_* are inlined into the bundle (an update without them talks to
// the dev fallback API), and the env shapes the app config whose fingerprint
// is the runtime version (src/app-variant.js) — an update made with another
// env never matches the builds of that profile. So the publisher's shell
// loses every build-only variable, and the profile's eas.json env goes on top
// of what is left, as on the EAS worker; `eas update --environment` then adds
// the project's EAS environment variables (a branded app's identity).

// Never taken from the publisher's shell: on the EAS worker they come only
// from eas.json or the EAS environment.
const BUILD_ONLY_ENV = /^(EXPO_PUBLIC_|APP_ASSETS_DIR$|GOOGLE_SERVICES_FILE$)/

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
 *   env: Record<string, string | undefined>,
 * }} input
 * @returns {{ channel: string, environment: string, env: Record<string, string> }}
 * @throws when the profile's builds take no updates or the project is unknown.
 */
function resolveOtaPublish({ easJson, profile, env }) {
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
  return {
    channel: build.channel,
    environment: build.environment,
    env: { ...kept, ...build.env },
  }
}

module.exports = { resolveBuildProfile, resolveOtaPublish }
