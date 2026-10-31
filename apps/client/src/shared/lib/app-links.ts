// Runtime configuration of the public join/club pages and the app-link files.
// Read on the server at request time (these routes are dynamic), so a deploy
// changes them by restarting the container — no rebuild, unlike NEXT_PUBLIC_*.
// Unset or blank means "not configured": the matching button or file is left
// out rather than pointing somewhere wrong.

type Env = Record<string, string | undefined>

const value = (env: Env, name: string): string | null => {
  const v = env[name]?.trim()
  return v ? v : null
}

const list = (env: Env, name: string): string[] =>
  (env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

export type StoreLinks = {
  appStore: string | null
  googlePlay: string | null
  ruStore: string | null
  // The installable web app; the join link is opened there as /join/<code>.
  pwa: string | null
}

export const readStoreLinks = (env: Env = process.env): StoreLinks => ({
  appStore: value(env, "APP_STORE_URL"),
  googlePlay: value(env, "PLAY_STORE_URL"),
  ruStore: value(env, "RUSTORE_URL"),
  pwa: value(env, "PWA_URL")?.replace(/\/+$/, "") ?? null,
})

// The custom scheme every ClubSpace build registers; the app holds the code
// until sign-in (apps/mobile/src/features/join/pending-join.ts).
export const appJoinUrl = (code: string) =>
  `clubspace://join/${encodeURIComponent(code)}`

export const pwaJoinUrl = (links: StoreLinks, code: string): string | null =>
  links.pwa ? `${links.pwa}/join/${encodeURIComponent(code)}` : null

// Where server-side rendering reaches the API: the compose-internal address
// when given (no trip through the public proxy), else the public one.
export const apiBaseUrl = (env: Env = process.env): string =>
  (
    value(env, "API_INTERNAL_URL") ??
    value(env, "NEXT_PUBLIC_API_URL") ??
    "http://localhost:3000"
  ).replace(/\/+$/, "")

// The path the apps claim: only join links open the app, everything else on
// this host (legal pages, club pages) stays in the browser.
export const APP_LINK_PATHS = ["/join/*"]

// apple-app-site-association: iOS Universal Links. APPLE_TEAM_ID plus one or
// more comma-separated IOS_BUNDLE_ID values (the canonical app and any
// branded build under the same team). Null when not configured.
export const buildAppleAppSiteAssociation = (env: Env = process.env) => {
  const team = value(env, "APPLE_TEAM_ID")
  const bundles = list(env, "IOS_BUNDLE_ID")
  if (!team || bundles.length === 0) return null
  const appIDs = bundles.map((b) => `${team}.${b}`)
  return {
    applinks: {
      // `details` with `components` is the iOS 13+ shape; `apps` + `paths`
      // keep older devices working.
      apps: [],
      details: [
        {
          appIDs,
          components: APP_LINK_PATHS.map((path) => ({ "/": path })),
        },
        ...appIDs.map((appID) => ({ appID, paths: APP_LINK_PATHS })),
      ],
    },
  }
}

// assetlinks.json: Android App Links. Comma-separated ANDROID_PACKAGE and
// ANDROID_CERT_SHA256 (e.g. the Play app-signing key and the upload key);
// every fingerprint is declared for every package. Null when not configured.
export const buildAssetLinks = (env: Env = process.env) => {
  const packages = list(env, "ANDROID_PACKAGE")
  const fingerprints = list(env, "ANDROID_CERT_SHA256").map((f) =>
    f.toUpperCase(),
  )
  if (packages.length === 0 || fingerprints.length === 0) return null
  return packages.map((pkg) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: pkg,
      sha256_cert_fingerprints: fingerprints,
    },
  }))
}
