import { Platform, type ViewStyle } from "react-native"

import {
  radius as softRadius,
  shadows as softShadows,
  typography as softTypography,
  type RadiusScale,
  type ShadowSet,
  type Typography,
} from "./theme"
import type { ColorScheme } from "./themes"

/**
 * The *shape* half of a theme — radius scale, typography and shadows — kept
 * separate from colour. Because every screen already reads `theme.radius`,
 * `theme.typography` and `theme.shadows`, swapping the language re-forms the
 * whole app (sharp vs. rounded, flat vs. elevated, light vs. heavy type) with
 * no per-screen changes. "Soft" is the original look, preserved as a variant.
 */
export type DesignLanguage = {
  radius: RadiusScale
  typography: Typography
  shadows: ShadowSet
}

export type DesignLanguageKey = "soft" | "material" | "ios" | "carbon" | "brutal"

const shadow = (
  opacity: number,
  shadowRadius: number,
  y: number,
  elevation: number,
): ViewStyle =>
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#000",
      shadowOpacity: opacity,
      shadowRadius,
      shadowOffset: { width: 0, height: y },
    },
    android: { elevation },
    default: {},
  }) ?? {}

// ---- Soft (original) ----
const SOFT: DesignLanguage = {
  radius: softRadius,
  typography: softTypography,
  shadows: softShadows,
}

// ---- Material 3 (Google): generous radius, elevation, sentence-case labels ----
const MATERIAL: DesignLanguage = {
  radius: { xs: 8, sm: 12, md: 16, lg: 20, xl: 28, full: 9999 },
  typography: {
    ...softTypography,
    title: { fontSize: 27, fontWeight: "700", letterSpacing: -0.2 },
    heading: { fontSize: 21, fontWeight: "600", letterSpacing: 0 },
    subheading: { fontSize: 17, fontWeight: "600", letterSpacing: 0 },
    label: { ...softTypography.label, textTransform: "none", letterSpacing: 0.1 },
  },
  shadows: {
    none: {},
    sm: shadow(0.1, 6, 1, 1),
    md: shadow(0.16, 12, 3, 3),
    lg: shadow(0.22, 26, 8, 8),
  },
}

// ---- iOS (Apple HIG): minimal shadow, bold large titles, sentence-case ----
const IOS: DesignLanguage = {
  radius: { xs: 6, sm: 8, md: 12, lg: 16, xl: 22, full: 9999 },
  typography: {
    ...softTypography,
    title: { fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
    heading: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
    label: { ...softTypography.label, textTransform: "none", letterSpacing: 0 },
  },
  shadows: {
    none: {},
    sm: shadow(0.04, 4, 1, 0),
    md: shadow(0.06, 8, 2, 1),
    lg: shadow(0.1, 16, 4, 2),
  },
}

// ---- IBM Carbon: sharp 0-radius, flat, uppercase structured labels ----
const CARBON: DesignLanguage = {
  radius: { xs: 0, sm: 0, md: 0, lg: 0, xl: 0, full: 0 },
  typography: {
    ...softTypography,
    title: { fontSize: 26, fontWeight: "600", letterSpacing: 0 },
    heading: { fontSize: 20, fontWeight: "600", letterSpacing: 0 },
    label: { ...softTypography.label, letterSpacing: 0.8, textTransform: "uppercase" },
  },
  shadows: { none: {}, sm: {}, md: {}, lg: {} },
}

// ---- Neo-brutalism: near-sharp, hard offset shadow, heavy uppercase ----
const brutal = (scheme: ColorScheme): DesignLanguage => {
  const hard =
    Platform.select<ViewStyle>({
      ios: {
        shadowColor: scheme === "dark" ? "#f5f1e8" : "#111111",
        shadowOpacity: scheme === "dark" ? 0.9 : 1,
        shadowRadius: 0,
        shadowOffset: { width: 4, height: 4 },
      },
      android: { elevation: 5 },
      default: {},
    }) ?? {}
  return {
    radius: { xs: 2, sm: 2, md: 2, lg: 2, xl: 2, full: 4 },
    typography: {
      ...softTypography,
      title: { fontSize: 27, fontWeight: "800", letterSpacing: 0, textTransform: "uppercase" },
      heading: { fontSize: 20, fontWeight: "800", letterSpacing: 0 },
      body: { ...softTypography.body, fontWeight: "500" },
      label: { ...softTypography.label, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
    },
    shadows: { none: {}, sm: hard, md: hard, lg: hard },
  }
}

export const resolveLanguage = (
  key: DesignLanguageKey,
  scheme: ColorScheme,
): DesignLanguage => {
  switch (key) {
    case "material":
      return MATERIAL
    case "ios":
      return IOS
    case "carbon":
      return CARBON
    case "brutal":
      return brutal(scheme)
    default:
      return SOFT
  }
}

// Existing colour themes keep the Soft shape; the four design-system keys carry
// their signature shape.
const LANG_FOR_THEME: Record<string, DesignLanguageKey> = {
  material: "material",
  ios: "ios",
  carbon: "carbon",
  brutal: "brutal",
}

export const languageKeyForTheme = (themeKey: string): DesignLanguageKey =>
  LANG_FOR_THEME[themeKey] ?? "soft"
