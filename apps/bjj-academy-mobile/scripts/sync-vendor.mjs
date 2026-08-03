// Copies the Plyr player's stylesheet and icon sprite into `public/vendor/`.
//
// The web video player references them as `/vendor/plyr.*` (see
// src/features/video/use-player.web.tsx) rather than a CDN, so the player works
// offline and can't be blocked. `public/` is the one folder Expo both serves
// from `expo start --web` and copies into the export — putting them there is
// what makes the dev server show the same player as production.
//
// Without this the assets existed only in `dist-web/`, so the player rendered
// completely unstyled in dev — raw "PausePlay"/"UnmuteMute" blocks and native
// range inputs. It looks exactly like a broken player, and it isn't one, which
// is a trap for anyone verifying video locally.
//
// They stay out of git (see .gitignore): they're third-party build output, and
// their version should follow whatever `npm install` resolved.
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dest = join(root, "public/vendor")
const plyrDist = join(root, "../../node_modules/plyr/dist")

mkdirSync(dest, { recursive: true })
for (const file of ["plyr.css", "plyr.svg"]) {
  copyFileSync(join(plyrDist, file), join(dest, file))
}
console.log("[sync-vendor] public/vendor ← plyr.css, plyr.svg")
