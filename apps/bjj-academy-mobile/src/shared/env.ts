import Constants from "expo-constants"

const fromExpoExtra = (key: string): string | undefined => {
  const extra =
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? {}
  const value = extra[key]
  return typeof value === "string" ? value : undefined
}

const env = (key: string, fallback: string): string => {
  return process.env[key] ?? fromExpoExtra(key) ?? fallback
}

export const environment = {
  apiBaseUrl: env("EXPO_PUBLIC_API_URL", "http://localhost:3000"),
  brand: env("EXPO_PUBLIC_BRAND", "grappling"),
}
