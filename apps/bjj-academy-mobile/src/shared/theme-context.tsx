import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useColorScheme } from "react-native"

import {
  DEFAULT_THEME_KEY,
  isThemeKey,
  type ThemeKey,
  type ThemeMode,
} from "@bjj-academy/ui-kit/util"

import {
  getPreferences,
  subscribePreferences,
} from "../features/profile/preferences-store"
import { spacing, theme as defaultTheme, type Theme } from "./theme"
import {
  languageKeyForTheme,
  resolveLanguage,
} from "./design-language"
import { resolveAppColors, type ColorScheme } from "./themes"

const isMode = (v: unknown): v is ThemeMode =>
  v === "light" || v === "dark" || v === "auto"

const buildTheme = (key: ThemeKey, scheme: ColorScheme): Theme => {
  const { radius, typography, shadows } = resolveLanguage(
    languageKeyForTheme(key),
    scheme,
  )
  return {
    colors: resolveAppColors(key, scheme),
    spacing,
    radius,
    typography,
    shadows,
  }
}

const ThemeContext = createContext<Theme>(defaultTheme)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system: ColorScheme = useColorScheme() === "dark" ? "dark" : "light"
  const [themeKey, setThemeKey] = useState<ThemeKey>(DEFAULT_THEME_KEY)
  const [mode, setMode] = useState<ThemeMode>("auto")

  useEffect(() => {
    let active = true
    const apply = (p: { themeKey?: unknown; themeMode?: unknown }) => {
      if (isThemeKey(p.themeKey)) setThemeKey(p.themeKey)
      if (isMode(p.themeMode)) setMode(p.themeMode)
    }
    void getPreferences().then((p) => {
      if (active) apply(p)
    })
    const unsubscribe = subscribePreferences(apply)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const scheme: ColorScheme = mode === "auto" ? system : mode
  const value = useMemo(() => buildTheme(themeKey, scheme), [themeKey, scheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): Theme => useContext(ThemeContext)

/**
 * Builds a StyleSheet from the active theme, memoized so it only rebuilds when
 * the theme changes. Define the factory at module scope (stable reference):
 *   const makeStyles = (theme: Theme) => StyleSheet.create({ ... })
 *   const styles = useThemedStyles(makeStyles)
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme()
  return useMemo(() => factory(theme), [theme, factory])
}
