// Populates `public/` with the web assets that come from node_modules, from
// image processing or from the build env (the per-brand manifest), rather than
// being hand-written files in the repo.
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
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = join(root, "public")

// The same identity the native build gets (app.config.js): the neutral
// ClubSpace app, or a club's branded one — from the same env.
const { ASSET_FILES, buildWebManifest, resolveAppIdentity } = createRequire(
  import.meta.url,
)("../src/app-variant.js")
const identity = resolveAppIdentity(process.env)

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
const source = resolve(root, identity.assetsDir, ASSET_FILES.icon)
await Promise.all([
  sharp(source).resize(192, 192).png().toFile(join(icons, "icon-192.png")),
  sharp(source).resize(512, 512).png().toFile(join(icons, "icon-512.png")),
  sharp(source)
    .resize(410, 410, { fit: "contain", background: "#ffffff" })
    .extend({ top: 51, bottom: 51, left: 51, right: 51, background: "#ffffff" })
    .png()
    .toFile(join(icons, "icon-maskable-512.png")),
])

// --- Manifest ---------------------------------------------------------------
// Name and theme colour follow the brand; a static file used to install every
// deploy as «Грэпплинг Академия».
const manifest = buildWebManifest(process.env)
writeFileSync(
  join(publicDir, "manifest.webmanifest"),
  `${JSON.stringify(manifest, null, 2)}\n`,
)

console.log("[sync-web-assets] public/vendor ← plyr.css, plyr.svg")
console.log("[sync-web-assets] public/icons  ← 192, 512, maskable-512")
console.log(`[sync-web-assets] public/manifest.webmanifest ← «${manifest.name}»`)
