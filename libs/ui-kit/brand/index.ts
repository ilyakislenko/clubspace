/**
 * Brand presets keyed by Workspace.type.
 *
 * Keep the platform multi-tenant: never assume a single brand at build time.
 * Resolve the brand from the workspace the user signed into, then use the
 * preset values to render titles, accent colours, and copy.
 */

export type BrandKey = "grappling" | "fitness" | "yoga" | "generic"

export type Brand = {
  key: BrandKey
  /** Full localized name shown in titles and headers. */
  name: string
  /** Short label, fits in narrow UI. */
  shortName: string
  /** One-liner shown on landing / sign-in. */
  tagline: string
  /** Tailwind-compatible accent class (text colour). */
  accentText: string
  /** Tailwind-compatible accent class (bg). */
  accentBg: string
  /** Single emoji used as a logo placeholder. */
  emoji: string
}

const grappling: Brand = {
  key: "grappling",
  name: "Грэпплинг Академия",
  shortName: "Академия",
  tagline: "Курсы и техника для зала",
  accentText: "text-red-600",
  accentBg: "bg-red-600",
  emoji: "🥋",
}

const fitness: Brand = {
  key: "fitness",
  name: "Fitness Studio",
  shortName: "Fitness",
  tagline: "Программы тренировок",
  accentText: "text-orange-600",
  accentBg: "bg-orange-600",
  emoji: "💪",
}

const yoga: Brand = {
  key: "yoga",
  name: "Yoga Space",
  shortName: "Yoga",
  tagline: "Практики и медитация",
  accentText: "text-emerald-600",
  accentBg: "bg-emerald-600",
  emoji: "🧘",
}

const generic: Brand = {
  key: "generic",
  name: "Видеотека",
  shortName: "Видео",
  tagline: "Курсы и тренировки",
  accentText: "text-primary",
  accentBg: "bg-primary",
  emoji: "🎬",
}

const presets: Record<BrandKey, Brand> = { grappling, fitness, yoga, generic }

/**
 * Resolve a brand preset from a `Workspace.type` value (case-insensitive).
 * Unknown types fall back to the generic preset.
 */
export const brandFromWorkspaceType = (type: string | null | undefined): Brand => {
  switch ((type ?? "").toLowerCase()) {
    case "grappling":
      return grappling
    case "fitness":
      return fitness
    case "yoga":
      return yoga
    default:
      return generic
  }
}

export const getBrand = (key: BrandKey): Brand => presets[key]

/**
 * Resolve the build-time brand override for an instance, used before a user
 * is authenticated (sign-in screen, marketing pages). Reads
 * `NEXT_PUBLIC_BRAND` and falls back to the generic preset.
 */
export const getInstanceBrand = (): Brand => {
  const envValue =
    typeof process !== "undefined"
      ? (process.env?.NEXT_PUBLIC_BRAND ?? "")
      : ""
  return brandFromWorkspaceType(envValue)
}

