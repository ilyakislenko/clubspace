/// <reference lib="dom" />
import { isWeb } from "./platform"

// The web shell (`public/index.html`) paints a boot splash before the JS bundle
// parses. It can't know which of the six themes the member picked, so the app
// mirrors its resolved background colour here and the shell reads it back on
// the next load. Without this every reload flashes the *OS* colour scheme,
// which is jarring for anyone running a dark theme on a light system (or vice
// versa).
export const BOOT_BACKGROUND_KEY = "clubspace.bootBackground"

// The shell writes this straight into `style.background`. Anything we hand it
// therefore has to be a plain colour literal — never a `url(...)` or other
// function that could turn a tampered localStorage entry into a network fetch.
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/-]+\))$/i

export const isSafeBootColor = (value: string): boolean =>
  SAFE_COLOR.test(value.trim())

export const rememberBootBackground = (color: string): void => {
  if (!isWeb) return
  const value = color.trim()
  if (!isSafeBootColor(value)) return
  try {
    ;(globalThis as { localStorage?: Storage }).localStorage?.setItem(
      BOOT_BACKGROUND_KEY,
      value,
    )
  } catch {
    /* private mode / storage disabled — the shell falls back to its CSS */
  }
}
