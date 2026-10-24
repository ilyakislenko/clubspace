// Fails an EAS release build whose env would ship a broken binary: a missing or
// placeholder API URL, brand, club key, web URL or support email. Wired as the
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
  // A placeholder host, not merely a name containing "example": real domains
  // like myexample.org must pass.
  const isPlaceholderHost = (hostname) =>
    hostname === "localhost" ||
    hostname === "example.com" ||
    hostname.endsWith(".example.com") ||
    hostname === "example" ||
    hostname.endsWith(".example")
  const checkUrl = (name) => {
    const value = process.env[name] ?? ""
    let hostname = ""
    try {
      hostname = new URL(value).hostname
    } catch {
      /* falls through to the https check below */
    }
    if (!value.startsWith("https://") || hostname === "") {
      problems.push(`${name} must be an https URL, got "${value}"`)
    } else if (isPlaceholderHost(hostname)) {
      problems.push(`${name} is a placeholder, got "${value}"`)
    }
  }
  checkUrl("EXPO_PUBLIC_API_URL")
  checkUrl("EXPO_PUBLIC_WEB_URL")
  for (const name of [
    "EXPO_PUBLIC_BRAND",
    "EXPO_PUBLIC_WORKSPACE_KEY",
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
