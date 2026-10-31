// Fails an EAS release build whose env would ship a broken or non-compliant
// binary, and warns about missing push config. Wired as the
// `eas-build-pre-install` hook in package.json, so it runs on the EAS worker
// before anything is installed or bundled.
//
//   EAS_BUILD_PROFILE=store node scripts/check-release-env.mjs
//
// Release profiles: `production`/`store` (the neutral ClubSpace app) and
// `branded`/`branded-store` (one club's own app, which must carry its own name,
// bundle id and artwork). Every other profile — and a local run, where
// EAS_BUILD_PROFILE is unset — is a no-op. The rules live in
// src/release-env.js; see docs/store-distribution.md.
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const { checkReleaseEnv } = createRequire(import.meta.url)(
  "../src/release-env.js",
)

const profile = process.env.EAS_BUILD_PROFILE
const result = checkReleaseEnv({
  profile,
  platform: process.env.EAS_BUILD_PLATFORM,
  env: process.env,
  fileExists: (path) => existsSync(resolve(root, path)),
  sameFile: (a, b) =>
    readFileSync(resolve(root, a)).equals(readFileSync(resolve(root, b))),
})

if (result) {
  for (const warning of result.warnings) {
    console.warn(`[check-release-env] warning: ${warning}`)
  }
  if (result.errors.length > 0) {
    console.error(
      `[check-release-env] Refusing to build profile "${profile}":\n` +
        result.errors.map((p) => `  - ${p}`).join("\n") +
        "\nRun scripts/set-mobile-target.sh to fill in eas.json; a branded " +
        "app's identity comes from its EAS environment variables " +
        "(docs/store-distribution.md).",
    )
    process.exit(1)
  }
  console.log(`[check-release-env] ${profile} env OK`)
}
