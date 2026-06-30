/**
 * Mobile colour palettes derived from the canonical token data shared with the
 * web admin (`@bjj-academy/ui-kit/util`). Same 6 themes × light/dark — single
 * source of truth. This maps the web semantic tokens onto the mobile colour
 * shape (surface tiers, soft variants, media overlays) the RN screens consume.
 */
import { THEMES, type ThemeKey, type TokenSet } from "@bjj-academy/ui-kit/util"

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
