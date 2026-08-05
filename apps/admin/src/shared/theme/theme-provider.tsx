"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

import {
  DEFAULT_THEME_KEY,
  isThemeKey,
  type ThemeKey,
  type ThemeMode,
} from "@clubspace/ui-kit/util"

import { MODE_STORAGE_KEY, THEME_STORAGE_KEY } from "./theme-constants"

type ThemeContextValue = {
  themeKey: ThemeKey
  mode: ThemeMode
  setThemeKey: (key: ThemeKey) => void
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const isMode = (v: unknown): v is ThemeMode =>
  v === "light" || v === "dark" || v === "auto"

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches

const applyToDom = (themeKey: ThemeKey, mode: ThemeMode) => {
  const root = document.documentElement
  root.setAttribute("data-theme", themeKey)
  const dark = mode === "dark" || (mode === "auto" && systemPrefersDark())
  root.classList.toggle("dark", dark)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(DEFAULT_THEME_KEY)
  const [mode, setModeState] = useState<ThemeMode>("auto")

  // The no-flash script already applied the DOM; sync React state to match.
  useEffect(() => {
    const storedKey = localStorage.getItem(THEME_STORAGE_KEY)
    const storedMode = localStorage.getItem(MODE_STORAGE_KEY)
    if (isThemeKey(storedKey)) setThemeKeyState(storedKey)
    if (isMode(storedMode)) setModeState(storedMode)
  }, [])

  // Apply + persist on every change.
  useEffect(() => {
    applyToDom(themeKey, mode)
    localStorage.setItem(THEME_STORAGE_KEY, themeKey)
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  }, [themeKey, mode])

  // Follow the OS appearance while in auto mode.
  useEffect(() => {
    if (mode !== "auto") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => applyToDom(themeKey, mode)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [mode, themeKey])

  const setThemeKey = useCallback((key: ThemeKey) => setThemeKeyState(key), [])
  const setMode = useCallback((next: ThemeMode) => setModeState(next), [])

  return (
    <ThemeContext.Provider value={{ themeKey, mode, setThemeKey, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
