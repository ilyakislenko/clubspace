import { Platform } from "react-native"

import { buildColors } from "./themes"

/**
 * Design tokens. Colours are themeable at runtime — prefer `useTheme()` /
 * `useThemedStyles()` from `./theme-context` in components. The static `theme`
 * export below is the default (Indigo light) used as a fallback by modules that
 * run outside React (and by not-yet-migrated screens). `spacing`, `radius`,
 * `typography`, and `shadows` are theme-independent and shared by all themes.
 */

export const spacing = (n: number) => n * 4

export const radius = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
}

export const typography = {
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
}

export const shadows = {
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
}

export const theme = {
  colors: buildColors("indigo", "light"),
  spacing,
  radius,
  typography,
  shadows,
}

export type Theme = typeof theme
