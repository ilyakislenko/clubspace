import Constants from "expo-constants"

// Referenced STATICALLY so Expo/Metro inlines each value at bundle time on every
// platform. A dynamic `process.env[key]` is NOT inlined — it reads an empty
// object at runtime, which crashed the web (static) export. Add a line here for
// any new EXPO_PUBLIC_* var.
const PUBLIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_BRAND: process.env.EXPO_PUBLIC_BRAND,
}

const fromExpoExtra = (key: string): string | undefined => {
  const extra =
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? {}
  const value = extra[key]
  return typeof value === "string" ? value : undefined
}

// Resolution order:
// 1. process.env.EXPO_PUBLIC_*  — inlined by Expo at bundle time. EAS builds
//    pick this up from `eas.json` `env` block. This is the authoritative source
//    for production builds.
// 2. Constants.expoConfig.extra  — baked from `app.json` extra at build time.
//    Useful as an explicit dev fallback only.
// 3. The hardcoded fallback below — only used in __DEV__. In production we
//    throw, because a silent localhost fallback in a shipped binary is a
//    severe bug.
const env = (key: string, devFallback: string): string => {
  const fromProcess = PUBLIC_ENV[key]
  if (typeof fromProcess === "string" && fromProcess.length > 0) {
    return fromProcess
  }
  const fromExtra = fromExpoExtra(key)
  if (typeof fromExtra === "string" && fromExtra.length > 0) {
    return fromExtra
  }
  if (__DEV__) {
    return devFallback
  }
  throw new Error(
    `[env] Missing required environment variable "${key}" in production build. ` +
      `Set it in eas.json (build.<profile>.env) so Expo inlines it at bundle time.`,
  )
}

export const environment = {
  apiBaseUrl: env("EXPO_PUBLIC_API_URL", "http://localhost:3000"),
  brand: env("EXPO_PUBLIC_BRAND", "grappling"),
}
