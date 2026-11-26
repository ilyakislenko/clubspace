// Publishes an OTA update (EAS Update) to the installed builds of one eas.json
// profile, bundled with the env those builds were made with.
//
//   cd apps/mobile
//   export EAS_PROJECT_ID=<id> GOOGLE_SERVICES_FILE=<local google-services.json>
//   npm run update:ota -- production "Исправлено расписание"
//   npm run update:ota -- production "…" --platform android --rollout-percentage 20
//
// Runs `eas update --channel <profile channel> --environment <profile
// environment> --message "<message>"` plus any extra flags, with the env from
// src/ota-publish.js. Needs eas-cli on PATH (`npm i -g eas-cli`) and
// `eas login`. What can ship this way and how to roll back:
// docs/store-distribution.md, «OTA-обновления».
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const { resolveOtaPublish } = createRequire(import.meta.url)(
  "../src/ota-publish.js",
)

const [profile, message, ...extra] = process.argv.slice(2)
if (!profile || !message || message.startsWith("--")) {
  console.error(
    'Usage: npm run update:ota -- <profile> "<message>" [eas update flags…]\n' +
      "  profile: preview | production | branded (store/branded-store share " +
      "the channel of the profile they extend)",
  )
  process.exit(2)
}

let publish
try {
  publish = resolveOtaPublish({
    easJson: JSON.parse(readFileSync(join(root, "eas.json"), "utf8")),
    profile,
    args: extra,
    env: process.env,
    fileExists: (path) => existsSync(resolve(root, path)),
  })
} catch (error) {
  console.error(`[eas-update] ${error.message}`)
  process.exit(1)
}

const args = [
  "update",
  "--channel",
  publish.channel,
  "--environment",
  publish.environment,
  "--message",
  message,
  ...extra,
]
const shown = args.map((a) => (/^[\w.:/-]+$/.test(a) ? a : JSON.stringify(a)))
console.log(`[eas-update] eas ${shown.join(" ")}`)
const result = spawnSync("eas", args, {
  cwd: root,
  env: publish.env,
  stdio: "inherit",
})
if (result.error?.code === "ENOENT") {
  console.error("[eas-update] eas-cli is not installed: npm i -g eas-cli")
  process.exit(1)
}
process.exit(result.status ?? 1)
