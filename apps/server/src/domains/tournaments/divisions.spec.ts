import {
    ageFor,
    type DivisionForMatch,
    divisionName,
    type EntryFacts,
    entryWeightG,
    fits,
    formatKg,
    kgToGrams,
    levelRangeLabel,
    matchDivision,
    suggestDivision,
} from './divisions'

const div = (o: Partial<DivisionForMatch> & { id: string }): DivisionForMatch => ({
    sex: 'MALE',
    ageMin: 18,
    ageMax: 35,
    templateId: 't1',
    levelOrderFrom: 2,
    levelOrderTo: 3,
    weightMinG: null,
    weightMaxG: null,
    ...o,
})

const athlete = (o: Partial<EntryFacts> = {}): EntryFacts => ({
    sex: 'MALE',
    age: 25,
    weightG: 75000,
    level: { templateId: 't1', order: 2 },
    ...o,
})

// «64 70 76 82 +82» for men 18–35, blue–brown.
const ladder = [
    div({ id: 'd64', weightMaxG: 64000 }),
    div({ id: 'd70', weightMinG: 64000, weightMaxG: 70000 }),
    div({ id: 'd76', weightMinG: 70000, weightMaxG: 76000 }),
    div({ id: 'd82', weightMinG: 76000, weightMaxG: 82000 }),
    div({ id: 'd82p', weightMinG: 82000 }),
]

describe('ageFor', () => {
    it('counts by birth year, so New Year changes nothing within a year', () => {
        expect(ageFor(2010, '2026-01-01')).toBe(16)
        expect(ageFor(2010, '2026-12-31')).toBe(16)
        expect(ageFor(2010, '2025-12-31')).toBe(15)
    })
})

describe('entryWeightG', () => {
    it('takes the weighed weight once present, else the declared one', () => {
        expect(entryWeightG({ declaredWeightG: 76000, weighedWeightG: 77400 })).toBe(77400)
        expect(entryWeightG({ declaredWeightG: 76000, weighedWeightG: null })).toBe(76000)
    })
})

describe('fits', () => {
    it('min is exclusive, max inclusive', () => {
        const d76 = ladder[2]
        expect(fits(athlete({ weightG: 70000 }), d76)).toBe(false)
        expect(fits(athlete({ weightG: 70100 }), d76)).toBe(true)
        expect(fits(athlete({ weightG: 76000 }), d76)).toBe(true)
        expect(fits(athlete({ weightG: 76100 }), d76)).toBe(false)
    })

    it('open weight takes any weight, even none', () => {
        const open = div({ id: 'open' })
        expect(fits(athlete({ weightG: 140000 }), open)).toBe(true)
        expect(fits(athlete({ weightG: null }), open)).toBe(true)
        expect(fits(athlete({ weightG: null }), ladder[0])).toBe(false)
    })

    it('checks the level range on the same standard only', () => {
        const d = ladder[2]
        expect(fits(athlete({ level: { templateId: 't1', order: 3 } }), d)).toBe(true)
        expect(fits(athlete({ level: { templateId: 't1', order: 4 } }), d)).toBe(false)
        expect(fits(athlete({ level: { templateId: 't2', order: 2 } }), d)).toBe(false)
        expect(fits(athlete({ level: null }), d)).toBe(false)
        // No standard on the division: any level, none included.
        expect(fits(athlete({ level: null }), div({ id: 'x', templateId: null }))).toBe(true)
    })

    it('mixed sex takes both; a sexed division one; ages are inclusive', () => {
        expect(fits(athlete({ sex: 'FEMALE' }), div({ id: 'm', sex: null }))).toBe(true)
        expect(fits(athlete({ sex: 'FEMALE' }), div({ id: 'm' }))).toBe(false)
        expect(fits(athlete({ age: 18 }), div({ id: 'a' }))).toBe(true)
        expect(fits(athlete({ age: 35 }), div({ id: 'a' }))).toBe(true)
        expect(fits(athlete({ age: 36 }), div({ id: 'a' }))).toBe(false)
        expect(fits(athlete({ age: 17 }), div({ id: 'a' }))).toBe(false)
    })
})

describe('matchDivision', () => {
    it('finds the one fitting division', () => {
        expect(matchDivision(athlete({ weightG: 75000 }), ladder)?.id).toBe('d76')
        expect(matchDivision(athlete({ weightG: 120000 }), ladder)?.id).toBe('d82p')
    })

    it('null when none fits', () => {
        expect(matchDivision(athlete({ sex: 'FEMALE' }), ladder)).toBeNull()
    })

    it('null when several fit (the org assigns by hand)', () => {
        expect(matchDivision(athlete(), [...ladder, div({ id: 'open' })])).toBeNull()
    })
})

describe('suggestDivision', () => {
    it('offers the next weight with the same criteria for an off-weight athlete', () => {
        expect(suggestDivision(athlete({ weightG: 77400 }), ladder, 'd76')?.id).toBe('d82')
        expect(suggestDivision(athlete({ weightG: 69000 }), ladder, 'd76')?.id).toBe('d70')
    })

    it('nothing when the current division fits', () => {
        expect(suggestDivision(athlete({ weightG: 75000 }), ladder, 'd76')).toBeNull()
    })

    it('ignores divisions with other criteria', () => {
        const other = div({ id: 'kids82', ageMin: 8, ageMax: 9, weightMinG: 76000, weightMaxG: 82000 })
        expect(suggestDivision(athlete({ weightG: 77400 }), [ladder[2], other], 'd76')).toBeNull()
    })

    it('without a division: the plain match', () => {
        expect(suggestDivision(athlete({ weightG: 77400 }), ladder, null)?.id).toBe('d82')
    })
})

describe('names', () => {
    it('formats kg with a decimal comma', () => {
        expect(formatKg(76000)).toBe('76')
        expect(formatKg(77400)).toBe('77,4')
        expect(kgToGrams(77.4)).toBe(77400)
        expect(kgToGrams(0.1 + 0.2)).toBe(300)
    })

    it('builds the division name from the criteria', () => {
        const levels = [
            { order: 2, name: 'Синий' },
            { order: 3, name: 'Коричневый' },
        ]
        const label = levelRangeLabel(levels, 2, 3)
        expect(label).toBe('Синий – Коричневый')
        expect(levelRangeLabel(levels, 2, 2)).toBe('Синий')
        expect(levelRangeLabel(levels, null, null)).toBeNull()
        expect(divisionName(ladder[2], label)).toBe('Мужчины · 18–35 лет · Синий – Коричневый · до 76 кг')
        expect(divisionName(ladder[4], null)).toBe('Мужчины · 18–35 лет · св. 82 кг')
        expect(
            divisionName({ sex: 'FEMALE', ageMin: null, ageMax: null, weightMinG: null, weightMaxG: null }, null),
        ).toBe('Женщины · абсолютная')
        expect(
            divisionName({ sex: 'MALE', ageMin: 8, ageMax: 9, weightMinG: null, weightMaxG: 30000 }, null),
        ).toBe('Мальчики · 8–9 лет · до 30 кг')
        expect(
            divisionName({ sex: null, ageMin: 18, ageMax: null, weightMinG: null, weightMaxG: null }, null),
        ).toBe('от 18 лет · абсолютная')
    })
})
