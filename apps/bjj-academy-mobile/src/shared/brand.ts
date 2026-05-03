import { environment } from "./env"

export type BrandKey = "grappling" | "fitness" | "yoga" | "custom"

export type Brand = {
  key: BrandKey
  displayName: string
  tagline: string
  /**
   * Server-side workspace key the brand maps to. New sign-ups are placed
   * into this workspace as INVITED so the trainer can approve them. When a
   * brand can serve multiple workspaces (future multi-club setup), turn this
   * into an array and add a workspace picker.
   */
  workspaceKey: string
  colors: {
    accent: string
    accentText: string
  }
  legal: {
    privacyUrl: string
    termsUrl: string
    supportEmail: string
  }
}

const BRANDS: Record<BrandKey, Brand> = {
  grappling: {
    key: "grappling",
    displayName: "BJJ Academy",
    tagline: "Видеоархив грэпплинг-клуба",
    workspaceKey: "bjj-academy",
    colors: { accent: "#dc2626", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://bjj-academy.example/legal/privacy",
      termsUrl: "https://bjj-academy.example/legal/terms",
      supportEmail: "support@bjj-academy.example",
    },
  },
  fitness: {
    key: "fitness",
    displayName: "Fitness Hub",
    tagline: "Тренировки и разборы упражнений",
    workspaceKey: "fitness-hub",
    colors: { accent: "#0ea5e9", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://fitness-hub.example/legal/privacy",
      termsUrl: "https://fitness-hub.example/legal/terms",
      supportEmail: "support@fitness-hub.example",
    },
  },
  yoga: {
    key: "yoga",
    displayName: "Yoga Studio",
    tagline: "Йога-практики на каждый день",
    workspaceKey: "yoga-studio",
    colors: { accent: "#7c3aed", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://yoga-studio.example/legal/privacy",
      termsUrl: "https://yoga-studio.example/legal/terms",
      supportEmail: "support@yoga-studio.example",
    },
  },
  custom: {
    key: "custom",
    displayName: "Academy",
    tagline: "Видеотека клуба",
    workspaceKey: "default",
    colors: { accent: "#0f172a", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://example.com/legal/privacy",
      termsUrl: "https://example.com/legal/terms",
      supportEmail: "support@example.com",
    },
  },
}

const resolveBrandKey = (raw: string): BrandKey => {
  const normalized = raw.toLowerCase()
  if (normalized in BRANDS) return normalized as BrandKey
  return "custom"
}

export const brand: Brand = BRANDS[resolveBrandKey(environment.brand)]
