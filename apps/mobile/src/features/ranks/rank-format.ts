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

/**
 * Stripe marks drawn on a level's swatch must stay visible whatever colour the
 * coach gave the level — dark marks on a white belt, light ones on a black one.
 * Non-hex input (or no colour) gets the light mark.
 */
export const stripeColorOn = (color: string | null): string => {
  const hex = color?.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return "#ffffff"
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  const luminance =
    (0.299 * channel(0) + 0.587 * channel(2) + 0.114 * channel(4)) / 255
  return luminance > 0.6 ? "#0f172a" : "#ffffff"
}
