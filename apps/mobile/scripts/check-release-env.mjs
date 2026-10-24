// Fails an EAS release build whose env would ship a broken binary: a missing or
// placeholder API URL, club key, web URL or support email. Wired as the
// `eas-build-pre-install` hook in package.json, so it runs on the EAS worker
// before anything is installed or bundled.
//
//   EAS_BUILD_PROFILE=store node scripts/check-release-env.mjs
//
// Only the `production` and `store` profiles are checked; every other profile
// (and a local run, where EAS_BUILD_PROFILE is unset) is a no-op.
const RELEASE_PROFILES = ["production", "store"]
const profile = process.env.EAS_BUILD_PROFILE

if (RELEASE_PROFILES.includes(profile)) {
  const problems = []
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? ""
  if (!apiUrl.startsWith("https://")) {
    problems.push(`EXPO_PUBLIC_API_URL must be https, got "${apiUrl}"`)
  } else if (/example|localhost/i.test(apiUrl)) {
    problems.push(`EXPO_PUBLIC_API_URL is a placeholder, got "${apiUrl}"`)
  }
  for (const name of [
    "EXPO_PUBLIC_WORKSPACE_KEY",
    "EXPO_PUBLIC_WEB_URL",
    "EXPO_PUBLIC_SUPPORT_EMAIL",
  ]) {
    const value = process.env[name] ?? ""
    if (value.length === 0 || value.startsWith("REPLACE_")) {
      problems.push(`${name} is missing or still a REPLACE_ placeholder`)
    }
  }

  if (problems.length > 0) {
    console.error(
      `[check-release-env] Refusing to build profile "${profile}":\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\nRun scripts/set-mobile-target.sh to fill in eas.json.",
    )
    process.exit(1)
  }
  console.log(`[check-release-env] ${profile} env OK`)
}
