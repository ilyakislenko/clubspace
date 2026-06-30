/**
 * Canonical theme tokens — the single source of truth for app theming across
 * the admin (web) and the mobile app.
 *
 * Each token value is an **HSL triplet string** ("H S% L%") so the web can use
 * it directly via Tailwind's `hsl(var(--token))` convention, and the mobile app
 * can convert it to an `hsl(...)` / `hsla(...)` color string (see the mobile
 * `shared/themes.ts` mapping). No framework imports here — this file is imported
 * by the web CSS generator (node/tsx) and by React Native (Metro).
 *
 * To add a theme: add a `ThemeSpec` to `THEME_SPECS`. Light + dark token sets are
 * derived from the spec so neutrals stay cohesive and only the signature colours
 * change. Re-run `nx theme:generate @bjj-academy/ui-kit` to refresh the web CSS.
 */

export const THEME_KEYS = [
  "indigo",
  "emerald",
  "ocean",
  "violet",
  "sunset",
  "slate",
] as const

export type ThemeKey = (typeof THEME_KEYS)[number]

export type ThemeMode = "light" | "dark" | "auto"

/** Semantic tokens shared by both apps (camelCase → kebab CSS var by the generator). */
export type TokenSet = {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  border: string
  input: string
  ring: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
  sidebarBackground: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
}

export type ThemeDef = {
  key: ThemeKey
  /** Human label for switchers. */
  name: string
  light: TokenSet
  dark: TokenSet
}

type ThemeSpec = {
  key: ThemeKey
  name: string
  /** Hue (0–360) for the tinted-grey neutrals so each theme reads as a family. */
  neutralHue: number
  primaryLight: string
  primaryDark: string
  primaryFgLight?: string
  primaryFgDark?: string
}

const WHITE = "0 0% 100%"
const DESTRUCTIVE_LIGHT = "4 74% 49%"
const DESTRUCTIVE_DARK = "6 70% 67%"
const SUCCESS_LIGHT = "145 55% 38%"
const SUCCESS_DARK = "145 50% 60%"
const WARNING_LIGHT = "38 80% 45%"
const WARNING_DARK = "40 80% 62%"

const lightTokens = (s: ThemeSpec): TokenSet => {
  const n = s.neutralHue
  const primary = s.primaryLight
  const primaryFg = s.primaryFgLight ?? WHITE
  return {
    background: `${n} 14% 98%`,
    foreground: `${n} 12% 11%`,
    card: `${n} 22% 100%`,
    cardForeground: `${n} 12% 11%`,
    popover: `${n} 22% 100%`,
    popoverForeground: `${n} 12% 11%`,
    primary,
    primaryForeground: primaryFg,
    secondary: `${n} 12% 93%`,
    secondaryForeground: `${n} 10% 22%`,
    muted: `${n} 12% 95%`,
    mutedForeground: `${n} 7% 42%`,
    accent: `${n} 14% 91%`,
    accentForeground: `${n} 12% 14%`,
    destructive: DESTRUCTIVE_LIGHT,
    destructiveForeground: WHITE,
    success: SUCCESS_LIGHT,
    successForeground: WHITE,
    warning: WARNING_LIGHT,
    warningForeground: WHITE,
    border: `${n} 12% 88%`,
    input: `${n} 12% 88%`,
    ring: primary,
    chart1: primary,
    chart2: "207 65% 55%",
    chart3: "145 50% 46%",
    chart4: "38 80% 52%",
    chart5: "330 65% 60%",
    sidebarBackground: `${n} 14% 96%`,
    sidebarForeground: `${n} 12% 14%`,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: primaryFg,
    sidebarAccent: `${n} 14% 91%`,
    sidebarAccentForeground: `${n} 12% 14%`,
    sidebarBorder: `${n} 12% 88%`,
    sidebarRing: primary,
  }
}

const darkTokens = (s: ThemeSpec): TokenSet => {
  const n = s.neutralHue
  const primary = s.primaryDark
  const primaryFg = s.primaryFgDark ?? WHITE
  return {
    // Deep charcoal, not pure black — better depth on OLED, less smearing.
    background: `${n} 12% 7%`,
    foreground: `${n} 10% 92%`,
    card: `${n} 11% 10%`,
    cardForeground: `${n} 10% 92%`,
    popover: `${n} 11% 10%`,
    popoverForeground: `${n} 10% 92%`,
    primary,
    primaryForeground: primaryFg,
    secondary: `${n} 9% 15%`,
    secondaryForeground: `${n} 10% 88%`,
    muted: `${n} 9% 14%`,
    mutedForeground: `${n} 8% 62%`,
    accent: `${n} 9% 20%`,
    accentForeground: `${n} 10% 92%`,
    destructive: DESTRUCTIVE_DARK,
    destructiveForeground: `${n} 12% 8%`,
    success: SUCCESS_DARK,
    successForeground: `${n} 12% 8%`,
    warning: WARNING_DARK,
    warningForeground: `${n} 12% 8%`,
    border: `${n} 9% 18%`,
    input: `${n} 9% 18%`,
    ring: primary,
    chart1: primary,
    chart2: "207 55% 68%",
    chart3: "145 50% 65%",
    chart4: "38 75% 65%",
    chart5: "330 60% 70%",
    sidebarBackground: `${n} 14% 5%`,
    sidebarForeground: `${n} 10% 92%`,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: primaryFg,
    sidebarAccent: `${n} 9% 15%`,
    sidebarAccentForeground: `${n} 10% 92%`,
    sidebarBorder: `${n} 9% 14%`,
    sidebarRing: primary,
  }
}

const THEME_SPECS: ThemeSpec[] = [
  {
    key: "indigo",
    name: "Индиго",
    neutralHue: 264,
    primaryLight: "247 56% 56%",
    primaryDark: "247 70% 67%",
  },
  {
    key: "emerald",
    name: "Изумруд",
    neutralHue: 168,
    primaryLight: "160 84% 36%",
    primaryDark: "158 64% 50%",
  },
  {
    key: "ocean",
    name: "Океан",
    neutralHue: 213,
    primaryLight: "221 83% 53%",
    primaryDark: "213 90% 66%",
  },
  {
    key: "violet",
    name: "Аметист",
    neutralHue: 276,
    primaryLight: "262 83% 58%",
    primaryDark: "258 90% 72%",
  },
  {
    key: "sunset",
    name: "Закат",
    neutralHue: 24,
    primaryLight: "21 90% 48%",
    primaryDark: "27 96% 61%",
  },
  {
    key: "slate",
    name: "Графит",
    neutralHue: 215,
    primaryLight: "215 28% 24%",
    primaryDark: "210 18% 90%",
    primaryFgDark: "215 28% 12%",
  },
]

export const THEMES: Record<ThemeKey, ThemeDef> = THEME_SPECS.reduce(
  (acc, spec) => {
    acc[spec.key] = {
      key: spec.key,
      name: spec.name,
      light: lightTokens(spec),
      dark: darkTokens(spec),
    }
    return acc
  },
  {} as Record<ThemeKey, ThemeDef>,
)

export const DEFAULT_THEME_KEY: ThemeKey = "indigo"

export const isThemeKey = (v: unknown): v is ThemeKey =>
  typeof v === "string" && (THEME_KEYS as readonly string[]).includes(v)
