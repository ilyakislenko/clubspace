/** What expo-updates reports about the bundle the app is running. */
export type RunningUpdate = {
  isEnabled: boolean
  isEmbeddedLaunch: boolean
  updateId: string | null
}

/**
 * The start of the running OTA update's id, for support: Settings appends it
 * to the version («версия 1.0.0 · a1b2c3d4»); `eas update:view <group>` lists
 * the full ids per platform. null while the app runs the bundle built into the
 * binary, and when updates are off (a dev build, a build without
 * EAS_PROJECT_ID) — then the version alone says it all.
 */
export const shortUpdateId = ({
  isEnabled,
  isEmbeddedLaunch,
  updateId,
}: RunningUpdate): string | null =>
  isEnabled && !isEmbeddedLaunch && updateId ? updateId.slice(0, 8) : null
