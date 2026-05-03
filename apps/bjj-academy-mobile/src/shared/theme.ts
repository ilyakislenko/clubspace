import { brand } from "./brand"

/**
 * Tiny design-token sheet shared across mobile screens. Accent colours come
 * from the active brand so a re-skin only requires flipping
 * `EXPO_PUBLIC_BRAND`.
 */
export const theme = {
  colors: {
    background: "#ffffff",
    surface: "#f7f7f8",
    border: "#e5e5e7",
    text: "#0f1419",
    muted: "#6b7280",
    accent: brand.colors.accent,
    accentText: brand.colors.accentText,
    danger: "#dc2626",
    warning: "#f59e0b",
    success: "#16a34a",
  },
  spacing: (n: number) => n * 4,
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
  },
}
