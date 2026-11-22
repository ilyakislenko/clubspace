import { COMMON_ENGLISH_WORDS } from './common-english-words'
import { COMMON_RUSSIAN_WORDS, SPORT_MISHEARINGS, SPORT_TERMS } from '@clubspace/sport-glossary'
import {
    buildGlossary,
    clubTerms,
    describeSnaps,
    isCommonWord,
    phoneticKey,
    snapTerms,
} from './term-snap'

const GRAPPLING = buildGlossary(SPORT_TERMS.GRAPPLING)
const snap = (text: string) => snapTerms(text, GRAPPLING).text

describe('snapTerms', () => {
    it.each([
        // Whisper on «Octopus 2.0 · Vol 4 · часть 3» and the Kimura lesson.
        ['Komura Grip', 'Kimura Grip'],
        ['Breaking Komura Grip', 'Breaking Kimura Grip'],
        ['setting up the camorra so', 'setting up the kimura so'],
        ['Khmer trap', 'Kimura trap'],
        // OCR of a caption fading out at its right edge (Leg Lock lesson).
        ['SLX Attacks & Transition to Inside Sankakuh', 'SLX Attacks & Transition to Inside Sankaku'],
        ['Transitioning Between Knee Bar & Inside Sankal', 'Transitioning Between Knee Bar & Inside Sankaku'],
        ['Omaplata Sweep', 'Omoplata Sweep'],
        ['Darcy choke', 'Darce choke'],
        ['Ashi Gurami entry', 'Ashi Garami entry'],
        ['comura', 'kimura'],
    ])('snaps a misread term: %s', (text, expected) => {
        expect(snap(text)).toBe(expected)
    })

    it.each([
        'look at the camera',
        'a comma here',
        'drill guard half knee leg hook grip bridge',
        // An uncommon word one letter off a short term: «truck».
        'tuck your elbow',
        // Ordinary words, glossary words, short words, other spellings.
        'Attacking Far Leg from Half-Guard',
        'Hip Scoop into SLX',
        "Do's & Don'ts",
        'Controlling Leg Position in Inside Sankaku',
        'Craig Jones Shows the Perfect Kimura',
        'two Kimuras and an armbar',
        'omo plata',
        // Russian: ordinary words and a term declined.
        'Сегодня делаем кимуру из полугарда, потом город',
    ])('leaves «%s» alone', (text) => {
        expect(snapTerms(text, GRAPPLING)).toEqual({ text, snaps: [] })
    })

    it('snaps Russian to Russian, keeping the case ending', () => {
        expect(snapTerms('Делаем Комура и комуру', GRAPPLING)).toEqual({
            text: 'Делаем Кимура и кимуру',
            snaps: [
                { from: 'Комура', to: 'Кимура' },
                { from: 'комуру', to: 'кимуру' },
            ],
        })
    })

    it('keeps the case style of what it replaces, word for word', () => {
        expect(snap('INSIDE SANKAKUH')).toBe('INSIDE SANKAKU')
        expect(snap('Reverse de la Rivva')).toBe('Reverse de la Riva')
        // A lowercase read keeps the term's acronyms.
        expect(snapTerms('the slx atacks', buildGlossary(['SLX Attacks'])).text).toBe(
            'the SLX attacks',
        )
    })

    it('never snaps across punctuation', () => {
        expect(snap('Inside, Sankakuh')).toBe('Inside, Sankaku')
        expect(snapTerms('Inside, Sankakuh', GRAPPLING).snaps).toEqual([
            { from: 'Sankakuh', to: 'Sankaku' },
        ])
    })

    it('takes the closest term, the first listed on a tie', () => {
        // «Kamora» sounds alike (2 edits), «Kimura» is one letter off.
        expect(snapTerms('Komura', buildGlossary(['Kamora', 'Kimura'])).text).toBe('Kimura')
        expect(snapTerms('Kimuri', buildGlossary(['Kimura', 'Kimuro'])).text).toBe('Kimura')
    })

    it('snaps to a club’s own words', () => {
        const glossary = buildGlossary([], clubTerms(['Octopus 2.0 · Vol 4'], []))
        expect(snapTerms('Octapus Guard', glossary).text).toBe('Octopus Guard')
        expect(snapTerms('anything', buildGlossary([])).text).toBe('anything')
    })

    it('replaces known mishearings too short to snap by spelling', () => {
        const glossary = buildGlossary(SPORT_TERMS.GRAPPLING, [], SPORT_MISHEARINGS.GRAPPLING)
        expect(snapTerms('In the ghee, or No  Ghee? GHEE!', glossary)).toEqual({
            text: 'In the gi, or No-gi? GI!',
            snaps: [
                { from: 'ghee', to: 'gi' },
                { from: 'No  Ghee', to: 'No-gi' },
                { from: 'GHEE', to: 'GI' },
            ],
        })
        expect(snap('the ghee')).toBe('the ghee')
    })
})

describe('clubTerms', () => {
    it('takes manual chapter titles as phrases and uncommon title words', () => {
        expect(
            clubTerms(
                ['Octopus 2.0 · Vol 4 · часть 3', 'Leg Lock Entries from Bottom Half-Guard', '2024'],
                ['Kimura Trap', 'Breaking the Kimura Grip from Bottom', 'Danaher 2.0'],
            ),
        ).toEqual(['Kimura Trap', 'Octopus', 'Kimura', 'Danaher'])
    })
})

describe('buildGlossary', () => {
    it('keeps one term per spelling and skips the too short', () => {
        const glossary = buildGlossary(['Kimura', 'Gi', '50/50'], ['kimura', 'Octopus'])
        expect(glossary.terms.map((term) => term.canonical)).toEqual(['Kimura', 'Octopus'])
        expect(glossary.words).toEqual(new Set(['kimura', 'octopus']))
        expect(glossary.sportTerms).toEqual(['Kimura', 'Gi', '50/50'])
    })

    it('has a vocabulary for every kind of club', () => {
        expect(Object.keys(SPORT_TERMS).sort()).toEqual([
            'CUSTOM',
            'DANCE',
            'FITNESS',
            'GRAPPLING',
            'YOGA',
        ])
        expect(SPORT_TERMS.GRAPPLING.length).toBeGreaterThan(200)
    })
})

describe('phoneticKey / isCommonWord', () => {
    it('hears Kimura in its misreadings, in either script', () => {
        for (const word of ['Kimura', 'Komura', 'Camorra', 'кимура', 'комура']) {
            expect(phoneticKey(word)).toBe('kmr')
        }
        expect(phoneticKey('Darcy')).toBe(phoneticKey('Darce'))
        expect(phoneticKey('phoque')).toBe('fk')
        expect(phoneticKey('xenon')).toBe('ksn')
    })

    it('knows ordinary English and Russian words', () => {
        expect(COMMON_ENGLISH_WORDS.size).toBeGreaterThan(10_000)
        expect(COMMON_RUSSIAN_WORDS.has('город')).toBe(true)
        expect(isCommonWord('Camera')).toBe(true)
        expect(isCommonWord('Всё')).toBe(false)
        expect(isCommonWord('ЗАХВАТ')).toBe(true)
        expect(isCommonWord('Camorra')).toBe(false)
    })

    it('leaves body and medicine words alone', () => {
        // Vol 3 · 3: «trachea» was snapped to «Truck» four times.
        expect(snap('pressure on the trachea and the carotid')).toBe(
            'pressure on the trachea and the carotid',
        )
        for (const word of ['Trachea', 'clavicle', 'sternum', 'scapula', 'meniscus', 'трахею', 'ключицу', 'Лопатку']) {
            expect(isCommonWord(word)).toBe(true)
        }
        expect(snap('давим на трахею и ключицу')).toBe('давим на трахею и ключицу')
    })
})

describe('describeSnaps', () => {
    it('counts each distinct snap', () => {
        expect(
            describeSnaps([
                { from: 'Komura', to: 'Kimura' },
                { from: 'Inside Sankal', to: 'Inside Sankaku' },
                { from: 'Komura', to: 'Kimura' },
            ]),
        ).toEqual(['Komura→Kimura ×2', 'Inside Sankal→Inside Sankaku'])
    })
})
