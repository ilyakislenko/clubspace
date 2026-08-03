// Builds the installable PWA: runs the Expo web export, then layers the PWA
// bits (manifest, service worker, icons, iOS/install meta) onto the output.
//
//   EXPO_PUBLIC_API_URL=https://api.example.com \
//   EXPO_PUBLIC_BRAND=grappling \
//   node scripts/build-pwa.mjs
//
// The env vars are inlined at bundle time (see src/shared/env.ts) — point
// EXPO_PUBLIC_API_URL at your hosted server. Then serve dist-web/ from any static
// host (must be HTTPS for the service worker + install prompt).
import { execSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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

console.log("[build-pwa] layering PWA assets…")
mkdirSync(join(out, "icons"), { recursive: true })
copyFileSync(join(root, "assets/images/icon.png"), join(out, "icons/icon.png"))
copyFileSync(
  join(root, "web/manifest.webmanifest"),
  join(out, "manifest.webmanifest"),
)
copyFileSync(
  join(root, "web/service-worker.js"),
  join(out, "service-worker.js"),
)

// Bundle the Plyr player skin + icon sprite locally (used by the web video
// player) so there's no runtime CDN dependency — it works offline and can't be
// blocked. Referenced from src/features/video/use-player.web.tsx as /vendor/*.
mkdirSync(join(out, "vendor"), { recursive: true })
const plyrDist = join(root, "../../node_modules/plyr/dist")
copyFileSync(join(plyrDist, "plyr.css"), join(out, "vendor/plyr.css"))
copyFileSync(join(plyrDist, "plyr.svg"), join(out, "vendor/plyr.svg"))

const head = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#6d5dfc" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<meta name="apple-mobile-web-app-title" content="Академия" />',
  '<link rel="apple-touch-icon" href="/icons/icon.png" />',
  "<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/service-worker.js').catch(function(){})})}</script>",
].join("\n    ")

const indexPath = join(out, "index.html")
const html = readFileSync(indexPath, "utf8")
if (html.includes("manifest.webmanifest")) {
  console.log("[build-pwa] index.html already has PWA head — skipping inject")
} else {
  writeFileSync(indexPath, html.replace("</head>", `    ${head}\n  </head>`))
}

console.log("[build-pwa] done → dist-web/ (serve over HTTPS)")
