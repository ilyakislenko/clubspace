// The shared libs/sport-glossary (also the worker's vocabulary): its technique
// catalogue and matcher, tested here as the server is its other consumer.
import {
    extractTechniqueMentions,
    findTechniques,
    SPORT_TERM_SECTIONS,
    SPORT_TERMS,
    techniqueKey,
    techniquesFor,
} from '@clubspace/sport-glossary'

const grappling = techniquesFor('GRAPPLING')
const byKey = (key: string) => grappling.find((t) => t.key === key)!
const names = (text: string) =>
    findTechniques(text, grappling).map((m) => text.slice(m.start, m.end))

describe('the glossary', () => {
    it('keeps the flat vocabulary the sections spell out, in order', () => {
        for (const sport of ['GRAPPLING', 'FITNESS', 'YOGA', 'DANCE', 'CUSTOM'] as const) {
            expect(SPORT_TERM_SECTIONS[sport].flatMap((s) => s.terms)).toEqual(
                [...SPORT_TERMS[sport]],
            )
        }
        expect(SPORT_TERMS.GRAPPLING).toHaveLength(230)
    })
})

describe('techniquesFor', () => {
    it('builds the catalogue from the categorized terms, merging aliases', () => {
        expect(byKey('triangle')).toEqual({
            key: 'triangle',
            en: 'Triangle',
            ru: 'треугольник',
            category: 'submissions',
            spellings: ['Triangle', 'Triangle Choke'],
        })
        expect(grappling.find((t) => t.en === 'Triangle Choke')).toBeUndefined()
        expect(byKey('single-leg-x').spellings).toEqual(['Single Leg X', 'SLX'])
        expect(byKey('knee-cut').category).toBe('passes')
        expect(byKey('scissor-sweep').category).toBe('sweeps')
        expect(byKey('hip-escape').category).toBe('escapes')
        expect(byKey('50-50').category).toBe('positions')
    })

    it('leaves vocabulary that is not a technique out', () => {
        for (const word of ['Gi', 'No-Gi', 'Kuzushi', 'кимура']) {
            expect(grappling.some((t) => t.en === word)).toBe(false)
        }
    })

    it('lists other sports under one category and nothing for a custom club', () => {
        expect(techniquesFor('YOGA').every((t) => t.category === 'other')).toBe(true)
        expect(techniquesFor('CUSTOM')).toEqual([])
        expect(techniquesFor('GRAPPLING')).toBe(grappling)
    })

    it('makes keys from the English term', () => {
        expect(techniqueKey("Fireman's Carry")).toBe('fireman-s-carry')
        expect(techniqueKey('North-South Choke')).toBe('north-south-choke')
    })
})

describe('findTechniques', () => {
    it('matches any case, spaces or hyphens, whole words only', () => {
        expect(names('the NORTH SOUTH choke and a kimura')).toEqual([
            'NORTH SOUTH choke',
            'kimura',
        ])
        expect(names('Mountain climbers, no mount here: Kimuras')).toEqual(['mount'])
    })

    it('lets the longest name win where names overlap', () => {
        expect(names('Inside Heel Hook from Technical Mount')).toEqual([
            'Inside Heel Hook',
            'Technical Mount',
        ])
        expect(findTechniques('Triangle Choke', grappling).map((m) => m.key)).toEqual([
            'triangle',
        ])
    })

    it('finds the Russian form in any case ending', () => {
        expect(names('Берём кимуру и ставим треугольником')).toEqual([
            'кимуру',
            'треугольником',
        ])
        expect(findTechniques('удушения сзади', grappling).map((m) => m.key)).toEqual([
            'rear-naked-choke',
        ])
    })
})

describe('extractTechniqueMentions', () => {
    it('collects chapters, speech and the translation, once per technique, kind and second', () => {
        const mentions = extractTechniqueMentions({
            sport: 'GRAPPLING',
            chapters: [{ positionSec: 10, title: '  Kimura   setup ' }],
            segments: [
                { from: 20.9, to: 22, text: 'kimura grip, kimura again' },
                { from: 'x', text: 'kimura' },
                null,
            ],
            ruSegments: [{ from: 21, to: 22, text: 'хват на кимуру' }],
        })
        expect(mentions).toEqual([
            {
                technique: 'kimura',
                kind: 'chapter',
                atSec: 10,
                text: 'Kimura setup',
                matched: 'Kimura',
            },
            {
                technique: 'kimura',
                kind: 'speech',
                atSec: 20,
                text: 'kimura grip, kimura again',
                matched: 'kimura',
            },
            {
                technique: 'kimura',
                kind: 'speechRu',
                atSec: 21,
                text: 'хват на кимуру',
                matched: 'кимуру',
            },
        ])
    })

    it('ignores a stored value that is not a cue list, and a custom club', () => {
        expect(
            extractTechniqueMentions({ sport: 'GRAPPLING', chapters: [], segments: {} }),
        ).toEqual([])
        expect(
            extractTechniqueMentions({
                sport: 'CUSTOM',
                chapters: [{ positionSec: 1, title: 'Kimura' }],
            }),
        ).toEqual([])
    })
})
