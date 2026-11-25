// The gym's own name without the venue kind: «СК «Дворец спорта»» → «Дворец
// спорта», «мкр. Южные Ворота» → «Южные Ворота».
const gymOwnName = (gym: string): string => {
    const quoted = /«([^»]+)»/.exec(gym)
    return (quoted ? quoted[1] : gym.replace(/^(СК|РК|ТЦ|ДК|ФОК|мкр\.?)\s+/iu, '')).trim()
}

const words = (s: string): string[] =>
    s
        .toLocaleLowerCase('ru')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)

/**
 * The title already names the gym: clubs often call groups «BJJ Взрослые ·
 * Дворец спорта», and «· СК «Дворец спорта»» after it is an echo. Whole words
 * in a row; a name of only short words («Зал «А»», «Б2») never counts — «А»
 * is found in any title. Same rule as the admin's group labels.
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

/** «Название · Зал», the gym left out when there is none or the title names it. */
export const titleWithGym = (title: string, gym: string | null | undefined): string =>
    gym && !namesGym(title, gym) ? `${title} · ${gym}` : title
