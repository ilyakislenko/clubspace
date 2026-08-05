/**
 * Mobile colour palettes derived from the canonical token data shared with the
 * web admin (`@clubspace/ui-kit/util`). Same 6 themes × light/dark — single
 * source of truth. This maps the web semantic tokens onto the mobile colour
 * shape (surface tiers, soft variants, media overlays) the RN screens consume.
 */
import { THEMES, type ThemeKey, type TokenSet } from "@clubspace/ui-kit/util"

export type ColorScheme = "light" | "dark"

export type ThemeColors = {
  background: string
  surface: string
  surfaceElevated: string
  surfaceMuted: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  muted: string
  mutedFaint: string
  accent: string
  accentText: string
  accentSoft: string
  danger: string
  dangerSoft: string
  warning: string
  warningSoft: string
  success: string
  successSoft: string
  overlay: string
  playerBg: string
  overlayStrong: string
  overlaySoft: string
  onOverlay: string
}

type Hsl = { h: number; s: number; l: number }

const parse = (triplet: string): Hsl => {
  const [h, s, l] = triplet.trim().split(/\s+/)
  return { h: Number(h), s: Number(s.replace("%", "")), l: Number(l.replace("%", "")) }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const hsl = (t: string) => {
  const { h, s, l } = parse(t)
  return `hsl(${h}, ${s}%, ${l}%)`
}
const hsla = (t: string, a: number) => {
  const { h, s, l } = parse(t)
  return `hsla(${h}, ${s}%, ${l}%, ${a})`
}
const shiftL = (t: string, delta: number) => {
  const { h, s, l } = parse(t)
  return `hsl(${h}, ${s}%, ${clamp(l + delta)}%)`
}

const toColors = (t: TokenSet, scheme: ColorScheme): ThemeColors => {
  const light = scheme === "light"
  return {
    background: hsl(t.background),
    surface: shiftL(t.background, light ? 1.4 : 2.6),
    surfaceElevated: hsl(t.card),
    surfaceMuted: hsl(t.secondary),
    border: hsl(t.border),
    borderStrong: shiftL(t.border, light ? -8 : 10),
    text: hsl(t.foreground),
    textSecondary: hsl(t.secondaryForeground),
    muted: hsl(t.mutedForeground),
    mutedFaint: shiftL(t.mutedForeground, light ? 14 : -14),
    accent: hsl(t.primary),
    accentText: hsl(t.primaryForeground),
    accentSoft: hsla(t.primary, light ? 0.12 : 0.24),
    danger: hsl(t.destructive),
    dangerSoft: hsla(t.destructive, light ? 0.12 : 0.22),
    warning: hsl(t.warning),
    warningSoft: hsla(t.warning, light ? 0.14 : 0.22),
    success: hsl(t.success),
    successSoft: hsla(t.success, light ? 0.14 : 0.22),
    // Media surfaces stay dark in every theme — the player backdrop, scrims,
    // and on-overlay text/icons.
    overlay: "rgba(15, 15, 20, 0.6)",
    playerBg: "#000000",
    overlayStrong: "rgba(0, 0, 0, 0.65)",
    overlaySoft: "rgba(0, 0, 0, 0.18)",
    onOverlay: "#ffffff",
  }
}

export const buildColors = (
  themeKey: ThemeKey,
  scheme: ColorScheme,
): ThemeColors => toColors(THEMES[themeKey][scheme], scheme)

// ---- Palettes the flat token derivation can't express ----
// Neumorphism (monochrome, surface == background, borderless) and glassmorphism
// (translucent surfaces over a saturated ground) need explicit colours with
// alpha, so they bypass `buildColors`. Media/semantic tokens are shared.
const SEMANTIC = {
  danger: "#e5484d",
  dangerSoft: "rgba(229,72,77,0.14)",
  warning: "#f5a623",
  warningSoft: "rgba(245,166,35,0.16)",
  success: "#30a46c",
  successSoft: "rgba(48,164,108,0.16)",
  overlay: "rgba(15, 15, 20, 0.6)",
  playerBg: "#000000",
  overlayStrong: "rgba(0, 0, 0, 0.65)",
  overlaySoft: "rgba(0, 0, 0, 0.18)",
  onOverlay: "#ffffff",
}

type CoreColors = Pick<
  ThemeColors,
  | "background"
  | "surface"
  | "surfaceElevated"
  | "surfaceMuted"
  | "border"
  | "borderStrong"
  | "text"
  | "textSecondary"
  | "muted"
  | "mutedFaint"
  | "accent"
  | "accentText"
  | "accentSoft"
>

const fromCore = (c: CoreColors): ThemeColors => ({ ...c, ...SEMANTIC })

const NEU: Record<ColorScheme, ThemeColors> = {
  light: fromCore({
    background: "#e6e7ee",
    surface: "#e6e7ee",
    surfaceElevated: "#eef0f6",
    surfaceMuted: "#dcdee8",
    border: "#e6e7ee", // == background: neumorphism has no visible borders
    borderStrong: "#d3d5df",
    text: "#3f425f",
    textSecondary: "#565a76",
    muted: "#9a9dbb",
    mutedFaint: "#b7bad0",
    accent: "#6d5dfc",
    accentText: "#ffffff",
    accentSoft: "rgba(109,93,252,0.14)",
  }),
  dark: fromCore({
    background: "#2a2c38",
    surface: "#2a2c38",
    surfaceElevated: "#31333f",
    surfaceMuted: "#24252f",
    border: "#2a2c38",
    borderStrong: "#3a3c4a",
    text: "#c9cbdd",
    textSecondary: "#b0b2c8",
    muted: "#8386a3",
    mutedFaint: "#6a6d86",
    accent: "#8577ff",
    accentText: "#ffffff",
    accentSoft: "rgba(133,119,255,0.22)",
  }),
}

// Glass paints its background as a gradient behind the navigator, so the screen
// background itself is transparent. The stops + header tint live here too.
export const GLASS_GRADIENT: Record<ColorScheme, readonly string[]> = {
  light: ["#3a1d6e", "#6a2b9d", "#a83b78"],
  dark: ["#160a34", "#3a1668", "#5c1a52"],
}
export const GLASS_HEADER_BG: Record<ColorScheme, string> = {
  light: "rgba(46,20,90,0.55)",
  dark: "rgba(18,8,42,0.6)",
}

const GLASS: Record<ColorScheme, ThemeColors> = {
  light: fromCore({
    background: "transparent",
    surface: "rgba(255,255,255,0.14)",
    surfaceElevated: "rgba(255,255,255,0.2)",
    surfaceMuted: "rgba(255,255,255,0.1)",
    border: "rgba(255,255,255,0.28)",
    borderStrong: "rgba(255,255,255,0.42)",
    text: "#ffffff",
    textSecondary: "rgba(255,255,255,0.82)",
    muted: "rgba(255,255,255,0.66)",
    mutedFaint: "rgba(255,255,255,0.5)",
    accent: "#ffffff",
    accentText: "#3a1d6e",
    accentSoft: "rgba(255,255,255,0.18)",
  }),
  dark: fromCore({
    background: "transparent",
    surface: "rgba(255,255,255,0.09)",
    surfaceElevated: "rgba(255,255,255,0.14)",
    surfaceMuted: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.2)",
    borderStrong: "rgba(255,255,255,0.32)",
    text: "#ffffff",
    textSecondary: "rgba(255,255,255,0.8)",
    muted: "rgba(255,255,255,0.6)",
    mutedFaint: "rgba(255,255,255,0.42)",
    accent: "#ffffff",
    accentText: "#180d3a",
    accentSoft: "rgba(255,255,255,0.16)",
  }),
}

const OVERRIDES: Partial<Record<ThemeKey, Record<ColorScheme, ThemeColors>>> = {
  neu: NEU,
  glass: GLASS,
}

// Colours for any theme — the explicit override for neu/glass, else derived.
export const resolveAppColors = (
  themeKey: ThemeKey,
  scheme: ColorScheme,
): ThemeColors => OVERRIDES[themeKey]?.[scheme] ?? buildColors(themeKey, scheme)
