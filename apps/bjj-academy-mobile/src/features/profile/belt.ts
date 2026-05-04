import type { BeltRank } from "./preferences-store"

export type BeltInfo = {
  rank: BeltRank
  label: string
  color: string
  textColor: string
}

export const BELT_INFO: Record<BeltRank, BeltInfo> = {
  white: { rank: "white", label: "Белый пояс", color: "#f1f5f9", textColor: "#0f172a" },
  blue: { rank: "blue", label: "Синий пояс", color: "#1d4ed8", textColor: "#ffffff" },
  purple: { rank: "purple", label: "Фиолетовый пояс", color: "#6d28d9", textColor: "#ffffff" },
  brown: { rank: "brown", label: "Коричневый пояс", color: "#7c2d12", textColor: "#ffffff" },
  black: { rank: "black", label: "Чёрный пояс", color: "#0f172a", textColor: "#ffffff" },
  coral: { rank: "coral", label: "Коралловый пояс", color: "#ef4444", textColor: "#ffffff" },
  red: { rank: "red", label: "Красный пояс", color: "#b91c1c", textColor: "#ffffff" },
}

export const BELT_OPTIONS: BeltInfo[] = [
  BELT_INFO.white,
  BELT_INFO.blue,
  BELT_INFO.purple,
  BELT_INFO.brown,
  BELT_INFO.black,
  BELT_INFO.coral,
  BELT_INFO.red,
]

const stripeWord = (n: number): string => {
  const last = n % 10
  const last2 = n % 100
  if (last2 >= 11 && last2 <= 14) return "полосок"
  if (last === 1) return "полоска"
  if (last >= 2 && last <= 4) return "полоски"
  return "полосок"
}

export const formatBeltWithStripes = (
  rank: BeltRank,
  stripes: number,
): string => {
  const base = BELT_INFO[rank].label
  if (stripes <= 0) return base
  return `${base} · ${stripes} ${stripeWord(stripes)}`
}
