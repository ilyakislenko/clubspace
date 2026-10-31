import { environment } from "./env"

export type BrandKey = "grappling" | "fitness" | "yoga" | "custom" | "clubspace"

export type Brand = {
  key: BrandKey
  displayName: string
  tagline: string
  /**
   * Server-side workspace key new sign-ups are placed into as INVITED, for the
   * trainer to approve. This is the brand's default; EXPO_PUBLIC_WORKSPACE_KEY
   * overrides it, which is how a club's branded build serves that club. Null
   * in the neutral ClubSpace app (EXPO_PUBLIC_CLUB_PICKER=true): no club is
   * baked in and a member joins one by its code.
   */
  workspaceKey: string | null
  colors: {
    accent: string
    accentText: string
  }
  legal: {
    privacyUrl: string
    termsUrl: string
    deleteAccountUrl: string
    supportEmail: string
  }
}

const BRANDS: Record<BrandKey, Brand> = {
  grappling: {
    key: "grappling",
    displayName: "BJJ Academy",
    tagline: "Тренировки, расписание и прогресс клуба",
    workspaceKey: "bjj-academy",
    colors: { accent: "#5b58d9", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://clubspace.example/legal/privacy",
      termsUrl: "https://clubspace.example/legal/terms",
      deleteAccountUrl: "https://clubspace.example/legal/delete-account",
      supportEmail: "support@clubspace.example",
    },
  },
  fitness: {
    key: "fitness",
    displayName: "Fitness Hub",
    tagline: "Тренировки, расписание и прогресс зала",
    workspaceKey: "fitness-hub",
    colors: { accent: "#0ea5e9", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://fitness-hub.example/legal/privacy",
      termsUrl: "https://fitness-hub.example/legal/terms",
      deleteAccountUrl: "https://fitness-hub.example/legal/delete-account",
      supportEmail: "support@fitness-hub.example",
    },
  },
  yoga: {
    key: "yoga",
    displayName: "Yoga Studio",
    tagline: "Практики, расписание и прогресс студии",
    workspaceKey: "yoga-studio",
    colors: { accent: "#7c3aed", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://yoga-studio.example/legal/privacy",
      termsUrl: "https://yoga-studio.example/legal/terms",
      deleteAccountUrl: "https://yoga-studio.example/legal/delete-account",
      supportEmail: "support@yoga-studio.example",
    },
  },
  // The neutral ClubSpace app (eas profiles preview, production, store): no
  // sport, no club baked in.
  clubspace: {
    key: "clubspace",
    displayName: "ClubSpace",
    tagline: "Расписание, абонементы и прогресс вашего клуба",
    workspaceKey: null,
    colors: { accent: "#5b58d9", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://clubspace.example/legal/privacy",
      termsUrl: "https://clubspace.example/legal/terms",
      deleteAccountUrl: "https://clubspace.example/legal/delete-account",
      supportEmail: "support@clubspace.example",
    },
  },
  custom: {
    key: "custom",
    displayName: "Academy",
    tagline: "Тренировки, расписание и новости клуба",
    workspaceKey: "default",
    colors: { accent: "#0f172a", accentText: "#ffffff" },
    legal: {
      privacyUrl: "https://example.com/legal/privacy",
      termsUrl: "https://example.com/legal/terms",
      deleteAccountUrl: "https://example.com/legal/delete-account",
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
const withWorkspaceKey: Brand = environment.clubPicker
  ? { ...resolved, workspaceKey: null }
  : environment.workspaceKey
    ? { ...resolved, workspaceKey: environment.workspaceKey }
    : resolved

// Store listings and the in-app links must point at the deploy's own pages and
// inbox, not the brand's placeholder domains. Each is overridden independently
// so a deploy that sets only one still gets the rest from the brand.
const web = environment.webUrl?.replace(/\/+$/, "")

export const brand: Brand = {
  ...withWorkspaceKey,
  // A club's branded app greets members under the name on its icon; the
  // neutral app keeps its preset name whatever the env says.
  ...(!environment.clubPicker &&
    environment.appName && { displayName: environment.appName }),
  legal: {
    ...withWorkspaceKey.legal,
    ...(web && {
      privacyUrl: `${web}/legal/privacy`,
      termsUrl: `${web}/legal/terms`,
      deleteAccountUrl: `${web}/legal/delete-account`,
    }),
    ...(environment.supportEmail && {
      supportEmail: environment.supportEmail,
    }),
  },
}

// True in the neutral build that lets a member pick a club by code instead of
// being attached to one baked into the binary.
export const isClubPicker = brand.workspaceKey === null
