// Russian plural form: one → 1, 21; few → 2–4, 22–24; many → 0, 5–20, 25…
export const pluralRu = (
  n: number,
  one: string,
  few: string,
  many: string,
): string => {
  const last = Math.abs(n) % 10
  const last2 = Math.abs(n) % 100
  if (last2 >= 11 && last2 <= 14) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}
