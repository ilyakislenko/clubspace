import Constants from "expo-constants"

// Referenced STATICALLY so Expo/Metro inlines each value at bundle time on every
// platform. A dynamic `process.env[key]` is NOT inlined — it reads an empty
// object at runtime, which crashed the web (static) export. Add a line here for
// any new EXPO_PUBLIC_* var.
const PUBLIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_BRAND: process.env.EXPO_PUBLIC_BRAND,
  EXPO_PUBLIC_WORKSPACE_KEY: process.env.EXPO_PUBLIC_WORKSPACE_KEY,
  EXPO_PUBLIC_CLUB_PICKER: process.env.EXPO_PUBLIC_CLUB_PICKER,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
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
//    A dev fallback only: consulted solely when __DEV__, so a release build
//    without EAS env cannot silently pick up app.json's localhost.
// 3. The hardcoded fallback below — only used in __DEV__. In production we
//    throw, because a silent localhost fallback in a shipped binary is a
//    severe bug.
const env = (key: string, devFallback: string): string => {
  const fromProcess = PUBLIC_ENV[key]
  if (typeof fromProcess === "string" && fromProcess.length > 0) {
    return fromProcess
  }
  if (__DEV__) {
    const fromExtra = fromExpoExtra(key)
    if (typeof fromExtra === "string" && fromExtra.length > 0) {
      return fromExtra
    }
    return devFallback
  }
  throw new Error(
    `[env] Missing required environment variable "${key}" in production build. ` +
      `Set it in eas.json (build.<profile>.env) so Expo inlines it at bundle time.`,
  )
}

// Same resolution order as env(), minus the throw: an unset value is a valid
// answer, so callers get undefined and supply their own default. `extra` is
// likewise dev-only.
const optionalEnv = (key: string): string | undefined => {
  const fromProcess = PUBLIC_ENV[key]
  if (typeof fromProcess === "string" && fromProcess.length > 0) {
    return fromProcess
  }
  if (!__DEV__) return undefined
  const fromExtra = fromExpoExtra(key)
  if (typeof fromExtra === "string" && fromExtra.length > 0) {
    return fromExtra
  }
  return undefined
}

export const environment = {
  apiBaseUrl: env("EXPO_PUBLIC_API_URL", "http://localhost:3000"),
  brand: env("EXPO_PUBLIC_BRAND", "grappling"),
  workspaceKey: optionalEnv("EXPO_PUBLIC_WORKSPACE_KEY"),
  // Opt-in neutral build: no club is baked in, a member enters a club code.
  clubPicker: optionalEnv("EXPO_PUBLIC_CLUB_PICKER") === "true",
  webUrl: optionalEnv("EXPO_PUBLIC_WEB_URL"),
  supportEmail: optionalEnv("EXPO_PUBLIC_SUPPORT_EMAIL"),
}
