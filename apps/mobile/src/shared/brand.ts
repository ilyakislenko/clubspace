import { environment } from "./env"

export type BrandKey = "grappling" | "fitness" | "yoga" | "custom"

export type Brand = {
  key: BrandKey
  displayName: string
  tagline: string
  /**
   * Server-side workspace key new sign-ups are placed into as INVITED, for the
   * trainer to approve. This is the brand's default; EXPO_PUBLIC_WORKSPACE_KEY
   * overrides it, which is how one brand build serves a specific club.
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
    colors: { accent: "#5b58d9", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://clubspace.example/legal/privacy",
      termsUrl: "https://clubspace.example/legal/terms",
      supportEmail: "support@clubspace.example",
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

const resolved = BRANDS[resolveBrandKey(environment.brand)]

// The club's key is chosen when the club is created in the platform console,
// so it cannot be a constant here. Sign-in attaches a student to a club only
// when this value matches an existing Workspace.key — and it fails SILENTLY
// when it doesn't (send-auth-code's ensureInvitedMembership just returns), so
// a self-hosted deploy must be able to state the real one.
export const brand: Brand = environment.workspaceKey
  ? { ...resolved, workspaceKey: environment.workspaceKey }
  : resolved
