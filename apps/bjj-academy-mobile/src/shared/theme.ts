import { Platform, type TextStyle, type ViewStyle } from "react-native"

import type { ThemeKey } from "@bjj-academy/ui-kit/util"

import { buildColors, type ColorScheme, type ThemeColors } from "./themes"

/**
 * Design tokens. Colours AND the shape language (radius / typography / shadows)
 * are themeable at runtime — prefer `useTheme()` / `useThemedStyles()` from
 * `./theme-context` in components. The values below are the default "Soft"
 * language (the original look, preserved as one variant); the design-system
 * themes swap them out via `./design-language`, which is what makes the app
 * look unmistakably different from theme to theme rather than merely recoloured.
 */

export const spacing = (n: number) => n * 4

export type RadiusScale = {
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
  full: number
}

// One typography role. fontWeight is RN's own union (not a narrowed literal) so
// design languages can vary weight freely.
export type TypoStyle = {
  fontSize: number
  fontWeight?: TextStyle["fontWeight"]
  letterSpacing?: number
  lineHeight?: number
  textTransform?: TextStyle["textTransform"]
  color?: string
}

export type Typography = {
  title: TypoStyle
  heading: TypoStyle
  subheading: TypoStyle
  body: TypoStyle
  bodyStrong: TypoStyle
  caption: TypoStyle
  captionStrong: TypoStyle
  label: TypoStyle
}

export type ShadowSet = {
  none: ViewStyle
  sm: ViewStyle
  md: ViewStyle
  lg: ViewStyle
}

export const radius: RadiusScale = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
}

export const typography: Typography = {
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  heading: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  subheading: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400", lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: "600", lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: "400", color: "#605e68" },
  captionStrong: { fontSize: 13, fontWeight: "600", color: "#3a3940" },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#605e68",
  },
}

const softShadow = (
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

export const shadows: ShadowSet = {
  none: {},
  sm: softShadow(0.05, 6, 1, 1),
  md: softShadow(0.08, 12, 2, 2),
  lg: softShadow(0.12, 24, 8, 6),
}

export type Theme = {
  key: ThemeKey
  scheme: ColorScheme
  colors: ThemeColors
  spacing: (n: number) => number
  radius: RadiusScale
  typography: Typography
  shadows: ShadowSet
  // Some themes (e.g. glass) paint the app background as a gradient rendered
  // behind the whole navigator; the screen backgrounds are transparent so it
  // shows through. Undefined = a flat `colors.background`.
  backgroundGradient?: readonly string[]
  // The native-stack header background — usually `colors.background`, but a
  // translucent tint for themes whose screen background is transparent.
  navHeaderBg: string
}

export const theme: Theme = {
  key: "indigo",
  scheme: "light",
  colors: buildColors("indigo", "light"),
  spacing,
  radius,
  typography,
  shadows,
  navHeaderBg: buildColors("indigo", "light").background,
}
