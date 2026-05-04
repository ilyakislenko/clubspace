// Activity heuristics shared between the workspace members list and the
// member detail page. Ranges are picked so a "weekly drilling" student
// stays green and someone who's been silent for over three weeks shows
// red — that matches what coaches actually want to see at a glance.

export type ActivityLevel = "active" | "slowing" | "inactive" | "never"

export const computeActivity = (lastWatchedAt: string | null): ActivityLevel => {
  if (!lastWatchedAt) return "never"
  const ms = Date.now() - new Date(lastWatchedAt).getTime()
  const days = ms / (24 * 3600 * 1000)
  if (days <= 7) return "active"
  if (days <= 21) return "slowing"
  return "inactive"
}

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  active: "Активен",
  slowing: "Замедляется",
  inactive: "Простаивает",
  never: "Не начинал",
}

export const ACTIVITY_CHIP: Record<ActivityLevel, string> = {
  active:
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  slowing: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  inactive: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  never:
    "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-600/20 italic",
}

export const formatRelativeDays = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (24 * 3600 * 1000))
  if (days <= 0) return "сегодня"
  if (days === 1) return "вчера"
  if (days < 7) return `${days} дн назад`
  if (days < 30) return `${Math.floor(days / 7)} нед назад`
  if (days < 365) return `${Math.floor(days / 30)} мес назад`
  return `${Math.floor(days / 365)} г назад`
}
