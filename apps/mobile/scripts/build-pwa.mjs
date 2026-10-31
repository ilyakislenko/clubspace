// Builds the installable PWA: syncs the generated web assets into public/, runs
// the Expo web export, then stamps the service worker and injects its
// registration.
//
//   EXPO_PUBLIC_API_URL=https://api.example.com \
//   EXPO_PUBLIC_BRAND=clubspace EXPO_PUBLIC_CLUB_PICKER=true \
//   node scripts/build-pwa.mjs
//
// The env vars are inlined at bundle time (see src/shared/env.ts) — point
// EXPO_PUBLIC_API_URL at your hosted server. Then serve dist-web/ from any static
// host (must be HTTPS for the service worker + install prompt). The same env
// picks the app identity (src/app-variant.js): the neutral ClubSpace app, or a
// club's branded one (EXPO_PUBLIC_APP_NAME, EXPO_PUBLIC_APP_COLOR,
// APP_ASSETS_DIR) — its name, theme colour and icons land in the manifest.
//
// The <head> lives in `public/index.html`, which Expo uses as its template (see
// that file). Only the brand's name (home-screen title, link previews) and the
// service-worker registration are patched into the export, so `expo start
// --web` stays SW-free during dev.
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "dist-web")
const { resolveAppIdentity } = createRequire(import.meta.url)(
  "../src/app-variant.js",
)
const identity = resolveAppIdentity(process.env)

// env.ts throws at startup without these, so an export lacking either would
// ship a PWA that opens to a crash.
for (const name of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_BRAND"]) {
  if (!process.env[name]) {
    console.error(
      `[build-pwa] ${name} is not set — the build would crash at startup. ` +
        "Set it before exporting for real users.",
    )
    process.exit(1)
  }
}

// Must run before the export: Expo copies public/ verbatim into the output.
execSync("node scripts/sync-web-assets.mjs", { cwd: root, stdio: "inherit" })

console.log("[build-pwa] exporting web bundle…")
execSync("npx expo export --platform web --output-dir dist-web --clear", {
  cwd: root,
  stdio: "inherit",
})

// Everything static now comes out of `public/` — the shell, the manifest, the
// service worker, the install icons and the Plyr assets — so the dev server and
// the export serve byte-identical files. Fail loudly rather than shipping a PWA
// that can't be installed, or a player with no skin.
const REQUIRED = [
  "manifest.webmanifest",
  "service-worker.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "vendor/plyr.css",
  "vendor/plyr.svg",
]
for (const required of REQUIRED) {
  if (!existsSync(join(out, required))) {
    throw new Error(
      `[build-pwa] ${required} is missing from the export — it should have come ` +
        "from public/. Run `node scripts/sync-web-assets.mjs`.",
    )
  }
}

const REGISTER_SW =
  "<script>if('serviceWorker' in navigator){window.addEventListener('load'," +
  "function(){navigator.serviceWorker.register('/service-worker.js')" +
  ".catch(function(){})})}</script>"

const indexPath = join(out, "index.html")
const html = readFileSync(indexPath, "utf8")

// Stamp the service worker with this build's identity. The hashed bundle names
// ARE the build id: they change exactly when the code does, so a rebuild that
// produces identical output doesn't needlessly evict a member's cache.
console.log("[build-pwa] stamping the service worker…")
// Read the emitted files rather than index.html's <script> tags: the Plyr
// chunk is pulled in by a dynamic import() and never appears in the HTML, so a
// tag-only list would leave the video player uncached offline.
const jsDir = join(out, "_expo/static/js/web")
const bundles = readdirSync(jsDir)
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => `/_expo/static/js/web/${name}`)
if (bundles.length === 0) {
  throw new Error(
    "[build-pwa] no JS bundles in the export — the service worker would " +
      "precache nothing.",
  )
}
if (!html.includes("/_expo/static/js/web/")) {
  throw new Error(
    "[build-pwa] exported index.html doesn't reference a bundle — the export " +
      "looks broken.",
  )
}
const buildId = createHash("sha256")
  .update(bundles.join("|"))
  .digest("hex")
  .slice(0, 12)
// The shell, its bundle, and the player assets a downloaded video needs.
const precache = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  ...bundles,
  "/vendor/plyr.css",
  "/vendor/plyr.svg",
]

const swPath = join(out, "service-worker.js")
const sw = readFileSync(swPath, "utf8")
if (!sw.includes("__BUILD_ID__") || !sw.includes("__PRECACHE__")) {
  throw new Error(
    "[build-pwa] service-worker.js is missing its __BUILD_ID__/__PRECACHE__ " +
      "placeholders — it would ship with a constant cache name that never " +
      "evicts an old deploy.",
  )
}
writeFileSync(
  swPath,
  sw
    .replace("__BUILD_ID__", buildId)
    .replace("__PRECACHE__", JSON.stringify(precache)),
)
console.log(
  `[build-pwa] cache academy-${buildId}, ${precache.length} precached files`,
)
if (!html.includes("manifest.webmanifest")) {
  throw new Error(
    "[build-pwa] exported index.html is missing the PWA head — Expo did not " +
      "use public/index.html as its template. Check that the file exists.",
  )
}
// The template carries the neutral name; a branded deploy installs to the home
// screen and previews in messengers under its own.
const exportedManifest = JSON.parse(
  readFileSync(join(out, "manifest.webmanifest"), "utf8"),
)
if (exportedManifest.name !== identity.name) {
  throw new Error(
    `[build-pwa] the exported manifest names «${exportedManifest.name}», this ` +
      `build is «${identity.name}» — public/manifest.webmanifest is stale. Run ` +
      "`node scripts/sync-web-assets.mjs` with the same env.",
  )
}
const attr = identity.name
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
const named = html
  .replace(
    /(<meta name="apple-mobile-web-app-title" content=")[^"]*"/,
    `$1${attr}"`,
  )
  .replace(/(<meta property="og:site_name" content=")[^"]*"/, `$1${attr}"`)
if (named.includes("serviceWorker")) {
  console.log("[build-pwa] service worker already registered — skipping inject")
  writeFileSync(indexPath, named)
} else {
  writeFileSync(
    indexPath,
    named.replace("</body>", `  ${REGISTER_SW}\n</body>`),
  )
}
console.log(`[build-pwa] installs as «${identity.name}»`)

console.log("[build-pwa] done → dist-web/ (serve over HTTPS)")
