// Populates `public/` with the web assets that come from node_modules or from
// image processing, rather than being hand-written files in the repo.
//
//   node scripts/sync-web-assets.mjs
//
// `public/` is the one folder Expo both serves from `expo start --web` and
// copies into the export, so anything generated here shows up identically in
// dev and in production. That parity is the point: assets that only existed in
// `dist-web/` made the dev server look broken in ways production never was —
// the video player rendered completely unstyled (raw "PausePlay"/"UnmuteMute"
// blocks and native range inputs), and the manifest's icons 404'd on every load.
//
// Everything written here is gitignored: it's derived output whose version
// should follow whatever `npm install` resolved.
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = join(root, "public")

// --- Plyr: the web video player's skin + icon sprite ------------------------
// Referenced as `/vendor/plyr.*` by src/features/video/use-player.web.tsx
// instead of a CDN, so the player works offline and can't be blocked.
const vendor = join(publicDir, "vendor")
mkdirSync(vendor, { recursive: true })
const plyrDist = join(root, "../../node_modules/plyr/dist")
for (const file of ["plyr.css", "plyr.svg"]) {
  copyFileSync(join(plyrDist, file), join(vendor, file))
}

// --- Install icons ----------------------------------------------------------
// Chrome only offers "Install" when the manifest advertises icons at the sizes
// it asks for, and Android masks the icon to the launcher's shape — a
// non-maskable icon gets letterboxed into a white square. So: exact-size `any`
// icons plus a padded `maskable` one whose art stays inside the safe zone.
const icons = join(publicDir, "icons")
mkdirSync(icons, { recursive: true })
const source = join(root, "assets/images/icon.png")
await Promise.all([
  sharp(source).resize(192, 192).png().toFile(join(icons, "icon-192.png")),
  sharp(source).resize(512, 512).png().toFile(join(icons, "icon-512.png")),
  sharp(source)
    .resize(410, 410, { fit: "contain", background: "#ffffff" })
    .extend({ top: 51, bottom: 51, left: 51, right: 51, background: "#ffffff" })
    .png()
    .toFile(join(icons, "icon-maskable-512.png")),
])

console.log("[sync-web-assets] public/vendor ← plyr.css, plyr.svg")
console.log("[sync-web-assets] public/icons  ← 192, 512, maskable-512")
