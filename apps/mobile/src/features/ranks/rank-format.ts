const stripeWord = (n: number): string => {
  const last = n % 10
  const last2 = n % 100
  if (last2 >= 11 && last2 <= 14) return "полосок"
  if (last === 1) return "полоска"
  if (last >= 2 && last <= 4) return "полоски"
  return "полосок"
}

/** "Синий" + 2 → "Синий · 2 полоски"; no stripes → just the level name. */
export const formatLevelWithStripes = (
  levelName: string,
  stripes: number,
): string => {
  if (stripes <= 0) return levelName
  return `${levelName} · ${stripes} ${stripeWord(stripes)}`
}

// The admin's level colour is free text, so coaches type names as often as
// hex. Only names a swatch can actually render (CSS/RN named colours) matter.
const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  blue: "#0000ff",
  purple: "#800080",
  brown: "#a52a2a",
  red: "#ff0000",
  coral: "#ff7f50",
  orange: "#ffa500",
  yellow: "#ffff00",
  green: "#008000",
  gray: "#808080",
  grey: "#808080",
}

const toHex6 = (color: string): string | null => {
  const c = color.trim().toLowerCase()
  const named = NAMED_COLORS[c]
  if (named) return named.slice(1)
  const long = c.match(/^#([0-9a-f]{6})$/)?.[1]
  if (long) return long
  const short = c.match(/^#([0-9a-f]{3})$/)?.[1]
  if (short) return [...short].map((ch) => ch + ch).join("")
  return null
}

// 0 (black) … 1 (white); null when the colour can't be read.
const luminanceOf = (color: string | null): number | null => {
  const hex = color ? toHex6(color) : null
  if (!hex) return null
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return (0.299 * channel(0) + 0.587 * channel(2) + 0.114 * channel(4)) / 255
}

/**
 * Stripe marks drawn on a level's swatch must stay visible whatever colour the
 * coach gave the level — dark marks on a white belt, light ones on a black one.
 * The two marks are fixed, not theme tokens: they sit on the coach's colour,
 * not on a theme surface. Unparseable input (or no colour) gets the light mark.
 */
export const stripeColorOn = (color: string | null): string => {
  const luminance = luminanceOf(color)
  return luminance !== null && luminance > 0.6 ? "#0f172a" : "#ffffff"
}

/**
 * Whether a level's swatch would melt into the card under it — a white belt on
 * a light theme, a black one on a dark theme — and so needs a firm outline
 * rather than the hairline every swatch gets.
 */
export const swatchBlendsIn = (
  color: string | null,
  scheme: "light" | "dark",
): boolean => {
  const luminance = luminanceOf(color)
  if (luminance === null) return false
  return scheme === "light" ? luminance > 0.8 : luminance < 0.2
}
