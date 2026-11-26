import * as Updates from "expo-updates"

/**
 * Which JS the app is running, for support (Settings → «О приложении»): the
 * start of the EAS update id (`eas update:view <group>` lists the full ids
 * per platform), or «из сборки» while it runs the bundle built into the
 * binary. null when updates are off: a dev build, or a build made without
 * EAS_PROJECT_ID (src/app-variant.js).
 *
 * A downloaded update is applied by expo-updates itself on the next cold
 * start, so the app has no update prompt. `app-update.web.ts` is the PWA's
 * counterpart: expo-updates is native-only.
 */
export const runningUpdateLabel = (): string | null => {
  if (!Updates.isEnabled || !Updates.updateId) return null
  return Updates.isEmbeddedLaunch ? "из сборки" : Updates.updateId.slice(0, 8)
}
