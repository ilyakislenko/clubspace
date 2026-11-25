/** Минимальная форма группы для подписи в пикерах: зал либо объектом, либо строкой. */
export type GroupLabelSource = {
  name: string
  gym?: { name: string } | null
  gymName?: string | null
}

// Собственное имя зала без вида площадки: «СК «Дворец спорта»» → «Дворец спорта»,
// «мкр. Южные Ворота» → «Южные Ворота».
const gymOwnName = (gym: string): string => {
  const quoted = /«([^»]+)»/.exec(gym)
  return (quoted ? quoted[1] : gym.replace(/^(СК|РК|ТЦ|ДК|ФОК|мкр\.?)\s+/iu, "")).trim()
}

const words = (s: string): string[] =>
  s.toLocaleLowerCase("ru").split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Название уже называет зал: клубы часто зовут группы «BJJ Взрослые · Дворец
 * спорта», и «· СК «Дворец спорта»» после него — повтор. Совпадение — целыми
 * словами подряд; имя из одних коротких слов («Зал «А»», «Б2») не считается
 * названным: «А» найдётся в любом названии.
 */
export const namesGym = (title: string, gym: string): boolean => {
  const own = words(gymOwnName(gym))
  if (!own.some((w) => w.length >= 3)) return false
  const t = words(title)
  for (let i = 0; i + own.length <= t.length; i++) {
    if (own.every((w, j) => t[i + j] === w)) return true
  }
  return false
}

/**
 * Подпись группы в селектах и чипах: «Название · Зал».
 * Одноимённые группы разных залов иначе неразличимы; зал, уже названный в
 * названии группы, не повторяется.
 */
export const groupOptionLabel = (group: GroupLabelSource): string => {
  const gym = group.gym?.name ?? group.gymName
  return gym && !namesGym(group.name, gym) ? `${group.name} · ${gym}` : group.name
}
