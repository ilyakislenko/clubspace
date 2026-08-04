// Builds the installable PWA: runs the Expo web export, then layers on the
// pieces Expo doesn't produce — install icons, the manifest, the service
// worker (+ its registration), and the local Plyr assets.
//
//   EXPO_PUBLIC_API_URL=https://api.example.com \
//   EXPO_PUBLIC_BRAND=grappling \
//   node scripts/build-pwa.mjs
//
// The env vars are inlined at bundle time (see src/shared/env.ts) — point
// EXPO_PUBLIC_API_URL at your hosted server. Then serve dist-web/ from any static
// host (must be HTTPS for the service worker + install prompt).
//
// The <head> itself is NOT patched here: it lives in `public/index.html`, which
// Expo uses as its template (see that file). Only the service-worker
// registration is injected, so `expo start --web` stays SW-free during dev.
import { execSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "dist-web")

if (!process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    "[build-pwa] EXPO_PUBLIC_API_URL is not set — the build would crash at " +
      "startup. Set it to your hosted API before building for real users.",
  )
}

console.log("[build-pwa] exporting web bundle…")
execSync("npx expo export --platform web --output-dir dist-web --clear", {
  cwd: root,
  stdio: "inherit",
})

console.log("[build-pwa] generating install icons…")
mkdirSync(join(out, "icons"), { recursive: true })
const source = join(root, "assets/images/icon.png")
// Chrome only offers "Install" when the manifest advertises icons at the sizes
// it asks for, and Android masks the icon to the launcher's shape — a
// non-maskable icon gets letterboxed into a white square. So: exact-size `any`
// icons plus a padded `maskable` one whose art stays inside the safe zone.
await Promise.all([
  sharp(source).resize(192, 192).png().toFile(join(out, "icons/icon-192.png")),
  sharp(source).resize(512, 512).png().toFile(join(out, "icons/icon-512.png")),
  sharp(source)
    .resize(410, 410, { fit: "contain", background: "#ffffff" })
    .extend({ top: 51, bottom: 51, left: 51, right: 51, background: "#ffffff" })
    .png()
    .toFile(join(out, "icons/icon-maskable-512.png")),
])

// The manifest and the service worker live in `public/`, so Expo copies them
// into the export (and serves them from `expo start --web` too, which keeps dev
// and prod on the same manifest). Only assets Expo can't produce are added here.
for (const required of ["manifest.webmanifest", "service-worker.js"]) {
  if (!existsSync(join(out, required))) {
    throw new Error(
      `[build-pwa] ${required} is missing from the export — it should have been ` +
        "copied from public/. Check that the file still lives there.",
    )
  }
}

console.log("[build-pwa] layering PWA assets…")
// Bundle the Plyr player skin + icon sprite locally (used by the web video
// player) so there's no runtime CDN dependency — it works offline and can't be
// blocked. Referenced from src/features/video/use-player.web.tsx as /vendor/*.
mkdirSync(join(out, "vendor"), { recursive: true })
const plyrDist = join(root, "../../node_modules/plyr/dist")
copyFileSync(join(plyrDist, "plyr.css"), join(out, "vendor/plyr.css"))
copyFileSync(join(plyrDist, "plyr.svg"), join(out, "vendor/plyr.svg"))

const REGISTER_SW =
  "<script>if('serviceWorker' in navigator){window.addEventListener('load'," +
  "function(){navigator.serviceWorker.register('/service-worker.js')" +
  ".catch(function(){})})}</script>"

const indexPath = join(out, "index.html")
const html = readFileSync(indexPath, "utf8")
if (!html.includes("manifest.webmanifest")) {
  throw new Error(
    "[build-pwa] exported index.html is missing the PWA head — Expo did not " +
      "use public/index.html as its template. Check that the file exists.",
  )
}
if (html.includes("serviceWorker")) {
  console.log("[build-pwa] service worker already registered — skipping inject")
} else {
  writeFileSync(indexPath, html.replace("</body>", `  ${REGISTER_SW}\n</body>`))
}

console.log("[build-pwa] done → dist-web/ (serve over HTTPS)")
