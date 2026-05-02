/**
 * Single tiny design-token sheet shared across mobile screens.
 * Keep things flat — when this file gets crowded, refactor into proper tokens.
 */
export const theme = {
  colors: {
    background: "#ffffff",
    surface: "#f7f7f8",
    border: "#e5e5e7",
    text: "#0f1419",
    muted: "#6b7280",
    accent: "#dc2626",
    accentText: "#ffffff",
    danger: "#dc2626",
  },
  spacing: (n: number) => n * 4,
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
  },
}
