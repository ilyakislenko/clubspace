import { join } from 'path'

import { SPORT_RUSSIAN_TERMS } from '@clubspace/sport-glossary'
import {
    autoSubtitleLabel,
    buildCues,
    buildSubtitleKey,
    buildTranslationPrompt,
    fixTerminology,
    parseTranslation,
    publishAutoSubtitle,
    toVtt,
    translatedCues,
    translationRetryMessages,
    termsIn,
    unitsOf,
    vttTime,
    wrapLines,
} from './subtitles'

// The app's own WebVTT parser: what the members' player reads our tracks
// with. Required by path: an import would make this project depend on the
// mobile app (and its build) in the Nx graph.
const PARSER = join(__dirname, '..', '..', 'mobile', 'src', 'features', 'video', 'subtitle-vtt')
const { parseVtt } = jest.requireActual<{
    parseVtt: (raw: string) => Array<{ start: number; end: number; text: string }>
}>(PARSER)

const segment = (startSec: number, endSec: number, text: string) => ({ startSec, endSec, text })

describe('buildCues', () => {
    it('keeps a short segment as one cue', () => {
        expect(buildCues([segment(1, 4, 'Now we grip the collar.')])).toEqual([
            { unit: 0, startSec: 1, endSec: 4, text: 'Now we grip the collar.' },
        ])
    })

    it('joins a tiny segment to the one before it', () => {
        expect(
            buildCues([
                segment(0, 3, 'Now we grip the collar'),
                segment(3.2, 3.8, 'right.'),
                segment(10, 12, 'Okay.'),
            ]).map((cue) => [cue.startSec, cue.endSec, cue.text]),
        ).toEqual([
            [0, 3.8, 'Now we grip the collar right.'],
            // Too far from the last one to join it.
            [10, 12, 'Okay.'],
        ])
    })

    it('cuts a long segment into two-line cues, timed by their letters', () => {
        const text =
            'So if we go to a floating hand grip, Freddie would free it by rotating in. So when he tries to rotate in, I bring it further and further under his body here.'
        const cues = buildCues([segment(30, 42, text)])
        expect(cues.length).toBeGreaterThan(1)
        for (const cue of cues) {
            expect(wrapLines(cue.text).length).toBeLessThanOrEqual(2)
            expect(cue.endSec - cue.startSec).toBeLessThanOrEqual(7)
        }
        expect(cues.map((cue) => cue.text).join(' ')).toBe(text)
        expect(cues[0].startSec).toBe(30)
        expect(cues.at(-1)?.endSec).toBeCloseTo(42)
        expect(new Set(cues.map((cue) => cue.unit))).toEqual(new Set([0]))
    })

    it('does not cut a few slow words into one-word cues', () => {
        // 20 s of a five-word segment: one cue, not four.
        expect(buildCues([segment(0, 20, 'or we are in Barcelona')])).toHaveLength(1)
    })

    it('groups segments into sentences for translation', () => {
        const cues = buildCues([
            segment(0, 5, 'Now we grip the collar and'),
            segment(5, 10, 'pull him into the guard.'),
            segment(10, 15, 'Then we sweep to the mount!'),
            segment(15, 20, 'And finish from the top'),
        ])
        expect(cues.map((cue) => cue.unit)).toEqual([0, 0, 1, 2])
    })

    it('ends a sentence group past 300 letters even without a full stop', () => {
        const long = 'word '.repeat(70).trim()
        const cues = buildCues([segment(0, 30, long), segment(30, 60, long)])
        expect(cues[0].unit).not.toBe(cues.at(-1)?.unit)
    })

    it('skips empty text and keeps cues from breaking the file', () => {
        expect(
            buildCues([segment(0, 2, '  '), segment(2, 6, 'go --> there <b>now</b> please')]),
        ).toEqual([{ unit: 0, startSec: 2, endSec: 6, text: 'go → there bnow/b please' }])
    })
})

describe('wrapLines', () => {
    it('balances two lines of at most 42 characters', () => {
        expect(wrapLines('Short line.')).toEqual(['Short line.'])
        expect(wrapLines('See, I am posted at the elbow here. If he does this, it is')).toEqual([
            'See, I am posted at the elbow',
            'here. If he does this, it is',
        ])
    })

    it('runs on to more lines when two cannot hold it', () => {
        // 82 letters that no single break splits into two lines of 42.
        expect(
            wrapLines('Так что если мы перейдем к плавающему захвату руки, Фредди освободит его, повернув'),
        ).toEqual(['Так что если мы перейдем к плавающему', 'захвату руки, Фредди освободит его,', 'повернув'])
        const longer = wrapLines(`${'слово '.repeat(20).trim()}`)
        expect(longer.length).toBeGreaterThan(2)
        for (const line of longer) expect(line.length).toBeLessThanOrEqual(42)
        // One word longer than a line stands alone.
        expect(wrapLines(`a ${'x'.repeat(50)} b`)).toEqual(['a', 'x'.repeat(50), 'b'])
    })
})

describe('toVtt', () => {
    it('writes a WebVTT file the app’s parser reads back cue for cue', () => {
        const cues = buildCues([
            segment(0, 6, 'Guys will try to bring their hand on the ground back in right. If Freddie'),
            segment(6, 11, "Stumps pointed towards his head, it's going to be very weak."),
            segment(3725.5, 3729, 'An hour in: the Kimura.'),
        ])
        const vtt = toVtt(cues)
        expect(vtt.startsWith('WEBVTT\n\n1\n00:00:00.000 --> ')).toBe(true)
        expect(vtt).toContain('01:02:05.500 --> 01:02:09.000\nAn hour in: the Kimura.')
        expect(parseVtt(vtt)).toEqual(
            cues.map((cue) => ({
                start: Number(cue.startSec.toFixed(3)),
                end: Number(cue.endSec.toFixed(3)),
                text: wrapLines(cue.text).join('\n'),
            })),
        )
    })

    it('formats times to the millisecond', () => {
        expect(vttTime(0)).toBe('00:00:00.000')
        expect(vttTime(75.5)).toBe('00:01:15.500')
        expect(vttTime(-1)).toBe('00:00:00.000')
    })
})

describe('unitsOf / translatedCues', () => {
    const cues = buildCues([
        segment(0, 4, 'Now we grip the collar and'),
        segment(4, 8, 'pull him into the guard.'),
        segment(8, 12, 'Then we sweep.'),
    ])

    it('sends whole sentences for translation', () => {
        expect(unitsOf(cues)).toEqual([
            { id: 0, text: 'Now we grip the collar and pull him into the guard.' },
            { id: 1, text: 'Then we sweep.' },
        ])
    })

    it('spreads each translation over its sentence’s cues, keeping their times', () => {
        const translated = translatedCues(
            cues,
            new Map([
                [0, 'Берём захват за воротник и затягиваем в гард.'],
                [1, 'Потом свип.'],
            ]),
        )
        expect(translated.map((cue) => [cue.startSec, cue.endSec, cue.text])).toEqual([
            [0, 4, 'Берём захват за воротник'],
            [4, 8, 'и затягиваем в гард.'],
            [8, 12, 'Потом свип.'],
        ])
    })

    it('shows nothing for a sentence left untranslated', () => {
        expect(translatedCues(cues, new Map([[1, 'Потом свип.']]))).toHaveLength(1)
    })
})

describe('sport terminology', () => {
    const TERMS = SPORT_RUSSIAN_TERMS.GRAPPLING
    const say = (source: string, translation: string) => fixTerminology(source, translation, TERMS)

    it('finds the terms the English says, in any case, spaces and hyphens alike', () => {
        expect(
            termsIn('From Half-Guard we take the CROSSFACE, in the gi or no gi.', TERMS).map((t) => t.en),
        ).toEqual(['gi', 'no-gi', 'guard', 'half guard', 'crossface'])
        // Not inside other words: «passing» is no «pass», «give» no «gi».
        expect(termsIn('Keep passing, give it time; the mountain.', TERMS)).toEqual([])
    })

    it('puts mistranslated terms right, carrying a case ending over', () => {
        expect(say('I can see through the crossface here.', 'Я вижу через крестный захват.')).toBe(
            'Я вижу через кроссфейс.',
        )
        expect(say('They established a crucifix from the octopus.', 'Они установили крест из осьминога.')).toBe(
            'Они установили крусификс из октопус.',
        )
        expect(say('Finish with the crossface.', 'Заканчиваем перекрёстным захватом.')).toBe(
            'Заканчиваем кроссфейсом.',
        )
        expect(say('In the gi it is dangerous.', 'В гее это опасно.')).toBe('В ги это опасно.')
        expect(say('Play octopus guard.', 'Осьминог гард, играем в защите осьминога.')).toBe(
            'Октопус-гард, играем в октопус-гард.',
        )
        expect(say('From closed guard.', 'Из закрытой защиты.')).toBe('Из закрытый гард.')
        expect(say('Stay in half guard.', 'Оставайся в половинной защите.')).toBe('Оставайся в полугарде.')
    })

    it('says a term left in Latin letters the Russian way, but keeps a Latin one', () => {
        expect(say('Set up the Kimura and the SLX.', 'Ставим Kimura и SLX.')).toBe('Ставим Кимура и SLX.')
    })

    it('leaves words alone where the English did not say the term', () => {
        expect(say('Defend your neck.', 'Защита шеи, крест на груди.')).toBe('Защита шеи, крест на груди.')
        // Not a case ending: «защитить» is not a form of «защита».
        expect(say('Guard your neck.', 'Нужно защитить шею.')).toBe('Нужно защитить шею.')
    })
})

describe('translation prompt and answer', () => {
    const context = { videoTitle: 'Craig Jones Shows the Perfect Kimura', courses: [] }

    it('asks for natural Russian in the members’ terms, by id', () => {
        const phrases = [
            { id: 3, text: 'Set up the Kimura.' },
            { id: 4, text: 'Finish it.' },
        ]
        const terms = termsIn(phrases.map((p) => p.text).join('\n'), SPORT_RUSSIAN_TERMS.GRAPPLING)
        const [system, user] = buildTranslationPrompt(context, phrases, terms)
        expect(system.content).toContain('into Russian')
        expect(system.content).toContain('exactly as the terminology list gives them')
        expect(system.content).toContain('Add nothing, drop nothing')
        expect(user.content.split('\n')).toEqual([
            'Video title: Craig Jones Shows the Perfect Kimura',
            'Terminology (English → Russian): kimura → кимура',
            '2 phrases (ids 3, 4); answer with all 2:',
            '{"cues":[{"id":3,"text":"Set up the Kimura."},{"id":4,"text":"Finish it."}]}',
        ])
        expect(buildTranslationPrompt(context, phrases.slice(1), [])[1].content).not.toContain(
            'Terminology',
        )
        const [assistant, again] = translationRetryMessages('Конечно!')
        expect(assistant).toEqual({ role: 'assistant', content: 'Конечно!' })
        expect(again.content).toContain('{"cues":[{"id":1,"text":"..."}]}')
    })

    it('reads the translations the answer has, cleaned', () => {
        expect(
            parseTranslation(
                '{"cues":[{"id":3,"text":"Ставим  кимуру -->"},{"id":"4","text":"Добиваем."},{"id":5,"text":""},"x",{"id":6},{"id":"seven","text":"Семь"}]}',
            ),
        ).toEqual(
            new Map([
                [3, 'Ставим кимуру →'],
                [4, 'Добиваем.'],
            ]),
        )
        expect(parseTranslation('Sorry.').size).toBe(0)
    })
})

describe('autoSubtitleLabel / buildSubtitleKey', () => {
    it('names the track in its own language, marked automatic', () => {
        expect(autoSubtitleLabel('en')).toBe('English (авто)')
        expect(autoSubtitleLabel('ru')).toBe('Русский (авто)')
        expect(autoSubtitleLabel('not a code')).toBe('Not a code (авто)')
    })

    it('stores tracks where the server keeps uploaded ones', () => {
        expect(buildSubtitleKey('vid-1', 'ru')).toMatch(
            /^subtitles\/vid-1\/ru\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.vtt$/,
        )
    })
})

describe('publishAutoSubtitle', () => {
    const TRACK = { language: 'ru', vtt: 'WEBVTT\n', defaultIfNone: true }

    const build = (existing: unknown, defaults = 0) => {
        const uploads: Array<[string, string]> = []
        const store = {
            upload: jest.fn(async (key: string, body: string) => {
                uploads.push([key, body])
            }),
            publicUrl: (key: string) => `https://cdn.example/${key}`,
        }
        const prisma = {
            videoSubtitle: {
                findUnique: jest.fn(async () => existing),
                count: jest.fn(async () => defaults),
                create: jest.fn(async () => ({})),
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
        }
        return { prisma, store, uploads }
    }

    it('creates the automatic track, the default when the video has none', async () => {
        const { prisma, store, uploads } = build(null)
        await expect(publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)).resolves.toBe(
            'created',
        )
        const [key, body] = uploads[0]
        expect(body).toBe('WEBVTT\n')
        expect(prisma.videoSubtitle.create).toHaveBeenCalledWith({
            data: {
                videoId: 'vid-1',
                language: 'ru',
                source: 'auto',
                isDefault: true,
                label: 'Русский (авто)',
                storageKey: key,
                publicUrl: `https://cdn.example/${key}`,
            },
        })
        expect(prisma.videoSubtitle.count).toHaveBeenCalledWith({
            where: { videoId: 'vid-1', isDefault: true },
        })
    })

    it('leaves the default where it is', async () => {
        const { prisma, store } = build(null, 1)
        await publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)
        expect(prisma.videoSubtitle.create.mock.calls[0]).toMatchObject([{ data: { isDefault: false } }])
        const english = build(null)
        await publishAutoSubtitle(english.prisma as never, english.store, 'vid-1', {
            ...TRACK,
            language: 'en',
            defaultIfNone: false,
        })
        expect(english.prisma.videoSubtitle.count).not.toHaveBeenCalled()
    })

    it('never touches a track staff uploaded', async () => {
        const { prisma, store } = build({ id: 'sub-1', source: 'manual' })
        await expect(publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)).resolves.toBe('kept')
        expect(store.upload).not.toHaveBeenCalled()
    })

    it('replaces its own automatic track, unless staff replaced it meanwhile', async () => {
        const { prisma, store, uploads } = build({ id: 'sub-1', source: 'auto' })
        await expect(publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)).resolves.toBe(
            'replaced',
        )
        expect(prisma.videoSubtitle.updateMany).toHaveBeenCalledWith({
            where: { id: 'sub-1', source: 'auto' },
            data: {
                label: 'Русский (авто)',
                storageKey: uploads[0][0],
                publicUrl: `https://cdn.example/${uploads[0][0]}`,
            },
        })
        prisma.videoSubtitle.updateMany.mockResolvedValueOnce({ count: 0 })
        await expect(publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)).resolves.toBe('kept')
    })

    it('keeps a track staff uploaded a moment ago, and surfaces other errors', async () => {
        const { prisma, store } = build(null)
        prisma.videoSubtitle.create.mockRejectedValueOnce(
            Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
        )
        await expect(publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)).resolves.toBe('kept')
        prisma.videoSubtitle.create.mockRejectedValueOnce(new Error('connection lost'))
        await expect(publishAutoSubtitle(prisma as never, store, 'vid-1', TRACK)).rejects.toThrow(
            'connection lost',
        )
    })
})
