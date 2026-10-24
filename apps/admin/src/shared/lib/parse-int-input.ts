// Parses a whole number typed into a text field. Spaces (JS \s covers nbsp / narrow
// nbsp used as thousands separators) are stripped; anything that is not plain
// digits afterwards (decimals, letters, signs) is rejected — never coerced.
// Returns null for invalid input so callers can show an inline error instead
// of silently saving a default.
export const parseIntInput = (
  raw: string,
  range: { min: number; max: number },
): number | null => {
  const s = raw.replace(/\s/g, "")
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < range.min || n > range.max) return null
  return n
}
