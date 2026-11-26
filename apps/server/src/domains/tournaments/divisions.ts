// Which division an entry belongs to (design
// docs/design/2026-11-27-tournaments.md §4.1). Pure: no Prisma, no clock.
// Divisions are per-tournament config rows — sex, age band by birth year, a
// level range on one of the org's standards, a weight range in grams — so
// nothing here knows a sport.

export type CompetitorSex = 'FEMALE' | 'MALE'

export type DivisionCriteria = {
    // null = mixed.
    sex: CompetitorSex | null
    // Inclusive; null = no bound.
    ageMin: number | null
    ageMax: number | null
    // null = any level.
    templateId: string | null
    levelOrderFrom: number | null
    levelOrderTo: number | null
    // min exclusive, max inclusive; both null = open weight.
    weightMinG: number | null
    weightMaxG: number | null
}

export type DivisionForMatch = DivisionCriteria & { id: string }

// What the rules look at about one athlete.
export type EntryFacts = {
    sex: CompetitorSex
    age: number
    // The weighed weight once present, else the declared one (entryWeightG).
    weightG: number | null
    // The athlete's level on an org standard, when known.
    level: { templateId: string; order: number } | null
}

// «По году рождения»: the event's local year − the birth year.
export const ageFor = (birthYear: number, eventLocalDate: string): number =>
    Number(eventLocalDate.slice(0, 4)) - birthYear

export const entryWeightG = (e: {
    declaredWeightG: number | null
    weighedWeightG: number | null
}): number | null => e.weighedWeightG ?? e.declaredWeightG

export const isOpenWeight = (d: Pick<DivisionCriteria, 'weightMinG' | 'weightMaxG'>) =>
    d.weightMinG === null && d.weightMaxG === null

export const fitsWeight = (
    weightG: number | null,
    d: Pick<DivisionCriteria, 'weightMinG' | 'weightMaxG'>,
): boolean => {
    if (isOpenWeight(d)) return true
    if (weightG === null) return false
    if (d.weightMinG !== null && weightG <= d.weightMinG) return false
    if (d.weightMaxG !== null && weightG > d.weightMaxG) return false
    return true
}

// Everything but the weight: sex, age band, level range.
const fitsPerson = (e: EntryFacts, d: DivisionCriteria): boolean => {
    if (d.sex !== null && d.sex !== e.sex) return false
    if (d.ageMin !== null && e.age < d.ageMin) return false
    if (d.ageMax !== null && e.age > d.ageMax) return false
    if (d.templateId !== null) {
        if (!e.level || e.level.templateId !== d.templateId) return false
        if (d.levelOrderFrom !== null && e.level.order < d.levelOrderFrom) return false
        if (d.levelOrderTo !== null && e.level.order > d.levelOrderTo) return false
    }
    return true
}

export const fits = (e: EntryFacts, d: DivisionCriteria): boolean =>
    fitsPerson(e, d) && fitsWeight(e.weightG, d)

// The one fitting division, or null when none or several fit (the org
// assigns by hand; the «Без категории» filter finds them).
export const matchDivision = <D extends DivisionForMatch>(
    e: EntryFacts,
    divisions: D[],
): D | null => {
    const fitting = divisions.filter((d) => fits(e, d))
    return fitting.length === 1 ? fitting[0] : null
}

const sameCriteria = (a: DivisionCriteria, b: DivisionCriteria): boolean =>
    a.sex === b.sex &&
    a.ageMin === b.ageMin &&
    a.ageMax === b.ageMax &&
    a.templateId === b.templateId &&
    a.levelOrderFrom === b.levelOrderFrom &&
    a.levelOrderTo === b.levelOrderTo

// For an entry off the weight of its division: the fitting division with the
// same sex/age/level criteria (the next weight up or down). Without a
// current division, the plain match. null when the current one fits or
// nothing does.
export const suggestDivision = <D extends DivisionForMatch>(
    e: EntryFacts,
    divisions: D[],
    currentId: string | null,
): D | null => {
    const current = currentId ? divisions.find((d) => d.id === currentId) : undefined
    if (!current) return matchDivision(e, divisions)
    if (fits(e, current)) return null
    const fitting = divisions.filter(
        (d) => d.id !== current.id && sameCriteria(d, current) && fitsWeight(e.weightG, d),
    )
    return fitting.length === 1 ? fitting[0] : null
}

// 77400 → «77,4»; 76000 → «76».
export const formatKg = (grams: number): string => {
    const tenths = Math.round(grams / 100)
    const whole = Math.trunc(tenths / 10)
    const rest = Math.abs(tenths % 10)
    return rest === 0 ? String(whole) : `${whole},${rest}`
}

export const kgToGrams = (kg: number): number => Math.round(kg * 10) * 100
export const gramsToKg = (grams: number): number => Math.round(grams / 100) / 10

// Under 18 at the top of the band: «Мальчики» / «Девочки».
const sexLabel = (sex: CompetitorSex | null, ageMax: number | null): string | null => {
    if (sex === null) return null
    const kids = ageMax !== null && ageMax < 18
    if (sex === 'MALE') return kids ? 'Мальчики' : 'Мужчины'
    return kids ? 'Девочки' : 'Женщины'
}

const ageLabel = (min: number | null, max: number | null): string | null => {
    if (min !== null && max !== null) return min === max ? `${min} лет` : `${min}–${max} лет`
    if (min !== null) return `от ${min} лет`
    if (max !== null) return `до ${max} лет`
    return null
}

const weightLabel = (min: number | null, max: number | null): string => {
    if (max !== null) return `до ${formatKg(max)} кг`
    if (min !== null) return `св. ${formatKg(min)} кг`
    return 'абсолютная'
}

// «Синий» or «Синий – коричневый» from the template's levels by order.
export const levelRangeLabel = (
    levels: Array<{ order: number; name: string }>,
    from: number | null,
    to: number | null,
): string | null => {
    if (from === null && to === null) return null
    const name = (order: number | null) =>
        order === null ? null : (levels.find((l) => l.order === order)?.name ?? null)
    const a = name(from)
    const b = name(to)
    if (a && b) return a === b ? a : `${a} – ${b}`
    if (a) return `от ${a}`
    if (b) return `до ${b}`
    return null
}

// «Мужчины · 18–35 лет · Синий – коричневый · до 76 кг» / «св. 94 кг» /
// «абсолютная».
export const divisionName = (
    c: Pick<DivisionCriteria, 'sex' | 'ageMin' | 'ageMax' | 'weightMinG' | 'weightMaxG'>,
    levelLabel: string | null,
): string =>
    [
        sexLabel(c.sex, c.ageMax),
        ageLabel(c.ageMin, c.ageMax),
        levelLabel,
        weightLabel(c.weightMinG, c.weightMaxG),
    ]
        .filter((p): p is string => !!p)
        .join(' · ')
        .slice(0, 120)
