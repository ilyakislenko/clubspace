import { Platform } from "react-native"

import { brand } from "./brand"

/**
 * Design tokens shared across mobile screens. Accent comes from the active
 * brand (re-skin = flip EXPO_PUBLIC_BRAND). Everything else is intentional
 * neutral so the brand pops where it should.
 */
export const theme = {
  colors: {
    background: "#ffffff",
    surface: "#fafafa",
    surfaceElevated: "#ffffff",
    surfaceMuted: "#f4f4f5",
    border: "#e4e4e7",
    borderStrong: "#d4d4d8",
    text: "#09090b",
    textSecondary: "#3f3f46",
    muted: "#71717a",
    mutedFaint: "#a1a1aa",
    accent: brand.colors.accent,
    accentText: brand.colors.accentText,
    accentSoft: "rgba(220, 38, 38, 0.08)",
    danger: "#dc2626",
    dangerSoft: "rgba(220, 38, 38, 0.1)",
    warning: "#f59e0b",
    warningSoft: "rgba(245, 158, 11, 0.12)",
    success: "#16a34a",
    successSoft: "rgba(22, 163, 74, 0.12)",
    overlay: "rgba(0, 0, 0, 0.6)",
  },
  spacing: (n: number) => n * 4,
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
  },
  typography: {
    title: { fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.4 },
    heading: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2 },
    subheading: { fontSize: 17, fontWeight: "600" as const },
    body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
    bodyStrong: { fontSize: 15, fontWeight: "600" as const, lineHeight: 22 },
    caption: { fontSize: 13, fontWeight: "400" as const, color: "#71717a" },
    captionStrong: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: "#3f3f46",
    },
    label: {
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 0.6,
      textTransform: "uppercase" as const,
      color: "#71717a",
    },
  },
  shadows: {
    none: {},
    sm: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 1 },
      default: {},
    }),
    md: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
      default: {},
    }),
    lg: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
}
