/** Минимальная форма группы для подписи в пикерах: зал либо объектом, либо строкой. */
export type GroupLabelSource = {
  name: string
  gym?: { name: string } | null
  gymName?: string | null
}

/**
 * Подпись группы в селектах и чипах: «Название · Зал».
 * Одноимённые группы разных залов иначе неразличимы.
 */
export const groupOptionLabel = (group: GroupLabelSource): string => {
  const gym = group.gym?.name ?? group.gymName
  return gym ? `${group.name} · ${gym}` : group.name
}
