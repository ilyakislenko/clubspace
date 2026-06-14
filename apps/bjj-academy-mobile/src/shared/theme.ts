import { Platform } from "react-native"

import { brand } from "./brand"

/**
 * Linear-style design tokens (ported from the volt project). Subtle
 * blue-tinted neutrals + indigo primary. The brand still drives accent
 * so each workspace can recolor without touching neutrals.
 */
export const theme = {
  colors: {
    // Slight warm-cool blue-grey tint, like Linear
    background: "#f7f6f9",
    surface: "#fbfafc",
    surfaceElevated: "#ffffff",
    surfaceMuted: "#efedf2",
    border: "#e3e2e7",
    borderStrong: "#cfcdd5",
    text: "#18171b",
    textSecondary: "#3a3940",
    muted: "#605e68",
    mutedFaint: "#9b99a4",

    accent: brand.colors.accent,
    accentText: brand.colors.accentText,
    accentSoft: "rgba(91, 88, 217, 0.1)",

    danger: "#d24a3d",
    dangerSoft: "rgba(210, 74, 61, 0.12)",
    warning: "#c08a2a",
    warningSoft: "rgba(192, 138, 42, 0.14)",
    success: "#2fa05e",
    successSoft: "rgba(47, 160, 94, 0.14)",
    overlay: "rgba(15, 15, 20, 0.6)",
    // Darks for media surfaces — the video player backdrop, the subtitle
    // pill, thumbnail scrims — and the text/icons that sit on top of them.
    playerBg: "#000000",
    overlayStrong: "rgba(0, 0, 0, 0.65)",
    overlaySoft: "rgba(0, 0, 0, 0.18)",
    onOverlay: "#ffffff",
  },
  spacing: (n: number) => n * 4,
  radius: {
    xs: 4,
    sm: 8,
    md: 10,
    lg: 14,
    xl: 18,
    full: 9999,
  },
  typography: {
    title: { fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.5 },
    heading: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.3 },
    subheading: { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.2 },
    body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
    bodyStrong: { fontSize: 15, fontWeight: "600" as const, lineHeight: 22 },
    caption: { fontSize: 13, fontWeight: "400" as const, color: "#605e68" },
    captionStrong: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: "#3a3940",
    },
    label: {
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 0.6,
      textTransform: "uppercase" as const,
      color: "#605e68",
    },
  },
  shadows: {
    none: {},
    sm: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 1 },
      default: {},
    }),
    md: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
      default: {},
    }),
    lg: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
}
