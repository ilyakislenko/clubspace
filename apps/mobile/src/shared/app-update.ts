import * as Updates from "expo-updates"
import { shortUpdateId } from "./update-id"

/**
 * The running OTA update's short id, or null (see `shortUpdateId`). A
 * downloaded update is applied by expo-updates itself on the next cold start,
 * so the app has no update prompt. `app-update.web.ts` is the PWA's
 * counterpart: expo-updates is native-only.
 */
export const runningUpdateId = (): string | null => shortUpdateId(Updates)
