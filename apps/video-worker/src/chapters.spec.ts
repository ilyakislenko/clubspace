import { readFileSync } from 'fs'
import { join } from 'path'

import {
    bestReading,
    captionsOf,
    COARSE_STEP_SEC,
    DENSE_STEP_SEC,
    detectChapters,
    finalizeChapters,
    findPersistentTokens,
    findTitleCandidates,
    type FrameWindow,
    type OcrFrame,
    type OcrLine,
    publishChapters,
    refineCandidate,
    refineWindow,
    textsSimilar,
} from './chapters'

// OCR of real lessons, in the shape the prototype wrote it.
// leg-lock.coarse.json: «Leg Lock Entries from Bottom Half-Guard» (19 min),
//   a frame every 3 s at 960 px — 13 titles, a SAMURAI wall logo in most
//   frames and its «Brazilian Jiu Jitsu» tagline in some.
// leg-lock.dense.json: the same video read every 0.5 s around each title.
// disclaimer.coarse.json: a lesson with no titles, opening on a legal
//   disclaimer.
// Lines under confidence 60 were left out: nothing reads them.
type RawFrame = { t: number; lines: Array<{ text: string; conf: number; h: number; y: number }> }

const loadFrames = (name: string): OcrFrame[] =>
    (JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as RawFrame[]).map(
        (frame) => ({
            atSec: frame.t,
            lines: frame.lines.map((line) => ({
                text: line.text,
                confidence: line.conf,
                top: line.y,
                height: line.h,
            })),
        }),
    )

const LEG_LOCK = loadFrames('leg-lock.coarse.json')
const LEG_LOCK_DENSE = loadFrames('leg-lock.dense.json')
const DISCLAIMER = loadFrames('disclaimer.coarse.json')

// Serves the coarse pass from one recording and refine windows from another;
// a moment nobody recorded shows no text.
const recordedSource = (coarse: OcrFrame[], dense: OcrFrame[] = []) => {
    const byTime = new Map(dense.map((frame) => [frame.atSec, frame.lines]))
    const windows: FrameWindow[] = []
    return {
        windows,
        read: async (window: FrameWindow) => {
            windows.push(window)
            if (window.stepSec === COARSE_STEP_SEC) return coarse
            const frames: OcrFrame[] = []
            const endSec = window.startSec + (window.durationSec as number)
            for (let atSec = window.startSec; atSec <= endSec; atSec += window.stepSec) {
                frames.push({ atSec, lines: byTime.get(atSec) ?? [] })
            }
            return frames
        },
    }
}

const line = (text: string, overrides: Partial<OcrLine> = {}): OcrLine => ({
    text,
    confidence: 95,
    top: 438,
    height: 32,
    ...overrides,
})

const sighting = (atSec: number, text: string, confidence = 95) => {
    const [caption] = captionsOf([line(text, { confidence })], [])
    return { atSec, caption }
}

describe('detectChapters', () => {
    it('finds the titles of the Leg Lock lesson and none of its logo', async () => {
        const source = recordedSource(LEG_LOCK, LEG_LOCK_DENSE)
        const scan = await detectChapters(source)

        expect(scan.chapters).toEqual([
            { positionSec: 10, title: 'Attacking Far Leg from Half-Guard' },
            { positionSec: 161, title: 'Breaking Opponent to Near Side Hip' },
            { positionSec: 295, title: 'Breakdown with Your Leg Inside' },
            { positionSec: 337, title: 'Hip Scoop into SLX' },
            { positionSec: 429, title: 'SLX Attacks & Transition to Inside Sankakuh' },
            { positionSec: 502, title: 'SLX Toe Hold' },
            { positionSec: 538, title: 'Elevate into Inside Sankaku' },
            { positionSec: 558, title: 'Breaking Down to Inside Hip' },
            { positionSec: 659, title: 'Posting on Head to Help Transition' },
            { positionSec: 687, title: 'Controlling Leg Position in Inside Sankaku' },
            { positionSec: 942, title: 'Attacking the Straight Knee Bar' },
            { positionSec: 1067, title: 'Transitioning Between Knee Bar & Inside Sankal' },
            { positionSec: 1119, title: 'Review' },
        ])
        expect(scan).toMatchObject({ candidates: 13, coarseFrames: 381 })
        // The whole video once, then one short window per title.
        expect(source.windows[0]).toEqual({ startSec: 0, stepSec: COARSE_STEP_SEC })
        expect(source.windows).toHaveLength(14)
    })

    it('finds nothing in a lesson whose only text is a disclaimer', async () => {
        const source = recordedSource(DISCLAIMER)
        await expect(detectChapters(source)).resolves.toEqual({
            chapters: [],
            candidates: 0,
            coarseFrames: 92,
        })
        expect(source.windows).toHaveLength(1)
    })

    it('keeps the titles that hold for a second and drops one that flashed by', async () => {
        const coarse = [30, 90, 150].map((atSec, idx) => ({
            atSec,
            lines: [line(['Guard Retention', 'Inside Sankaku', 'Flash Caption'][idx])],
        }))
        const dense = [
            { atSec: 29.5, lines: [line('Guard Retention')] },
            { atSec: 30, lines: [line('Guard Retention')] },
            { atSec: 89, lines: [line('Inside Sankaku')] },
            { atSec: 89.5, lines: [line('Inside Sankaku')] },
            { atSec: 150, lines: [line('Flash Caption')] },
        ]
        const scan = await detectChapters(recordedSource(coarse, dense))
        expect(scan.chapters).toEqual([
            { positionSec: 29, title: 'Guard Retention' },
            { positionSec: 89, title: 'Inside Sankaku' },
        ])
    })

    it('does not refine a single caption', async () => {
        const coarse = [
            { atSec: 0, lines: [] },
            { atSec: 3, lines: [line('Guard Retention Basics')] },
        ]
        const source = recordedSource(coarse)
        await expect(detectChapters(source)).resolves.toMatchObject({
            chapters: [],
            candidates: 1,
        })
        expect(source.windows).toHaveLength(1)
    })

    it('gives up on burned-in subtitles instead of refining each line', async () => {
        // Two minutes of a new line every 3 s, no word on more than a few.
        const words = (
            'grip frame hips knee elbow shoulder posture pressure angle wrist ankle heel ' +
            'guard mount back chest head chin collar sleeve belt pants hook shin thigh ' +
            'spine weight balance base stance'
        ).split(' ')
        const coarse = Array.from({ length: 40 }, (_, idx) => ({
            atSec: idx * COARSE_STEP_SEC,
            lines: [line(`${words[idx % 30]} ${words[(idx + 11) % 30]} ${words[(idx + 23) % 30]}`)],
        }))
        const source = recordedSource(coarse)
        const scan = await detectChapters(source)
        expect(scan.chapters).toEqual([])
        expect(scan.candidates).toBeGreaterThan(10)
        expect(source.windows).toHaveLength(1)
    })
})

describe('findPersistentTokens', () => {
    it('picks out the wall logo, not the titles', () => {
        const persistent = findPersistentTokens(LEG_LOCK)
        expect(persistent).toContain('samurai')
        expect(persistent).not.toContain('sankaku')
        expect(persistent).not.toContain('brazilian')
        expect(persistent).not.toContain('inside')
    })

    it('counts the broken reads of a word toward it', () => {
        // «samurai» read whole on 5 of 40 frames, broken on 6 more: 11 > 6.
        const read = (idx: number) =>
            idx < 5 ? 'SAMURAI' : idx < 8 ? 'SAMURA' : idx < 11 ? 'MURAI' : null
        const frames = Array.from({ length: 40 }, (_, idx) => ({
            atSec: idx * 3,
            lines: read(idx) ? [line(read(idx) as string)] : [],
        }))
        expect(findPersistentTokens(frames)).toEqual(['samurai'])
        expect(findPersistentTokens(frames.slice(0, 5).concat(frames.slice(11)))).toEqual([])
    })

    it('ignores unsure reads, short words and a word on a few frames of a short clip', () => {
        const frames = Array.from({ length: 10 }, (_, idx) => ({
            atSec: idx * 3,
            lines: [
                line('Watermark', { confidence: 50 }),
                line('TV'),
                ...(idx < 3 ? [line('Opening Title')] : []),
            ],
        }))
        expect(findPersistentTokens(frames)).toEqual([])
    })

    // Distinct six-letter words, all alike: the worst case for the fuzzy
    // comparison. The first `frequent` are each on 5 frames, the rest on one;
    // 5 words to a line, 5 lines to a frame.
    const wordsOnFrames = (count: number, frequent = count) => {
        const words = Array.from({ length: count }, (_, idx) =>
            [26 ** 4, 26 ** 3, 26 ** 2, 26, 1]
                .map((unit) => String.fromCharCode(97 + (Math.floor(idx / unit) % 26)))
                .join('')
                .padStart(6, 'q'),
        )
        const reads = words.flatMap((word, idx) => Array(idx < frequent ? 5 : 1).fill(word))
        // Spread out so a word's reads land on different frames.
        const spread = reads.map((_, idx) => reads[(idx * 7919) % reads.length])
        const lines = Array.from({ length: Math.ceil(spread.length / 5) }, (_, idx) =>
            spread.slice(idx * 5, idx * 5 + 5).join(' '),
        )
        return Array.from({ length: Math.ceil(lines.length / 5) }, (_, idx) => ({
            atSec: idx * 3,
            lines: lines.slice(idx * 5, idx * 5 + 5).map((text, k) => line(text, { top: k * 50 })),
        }))
    }

    const timed = <T>(run: () => T) => {
        const startedAt = Date.now()
        const result = run()
        return { result, ms: Date.now() - startedAt }
    }

    it('stays quick on a screen full of different words', () => {
        const { result, ms } = timed(() => findPersistentTokens(wordsOnFrames(2000, 125)))
        expect(result).not.toBeNull()
        expect(ms).toBeLessThan(1500)
    })

    it('gives up quickly on text too varied for a logo (slides, subtitles)', async () => {
        // 2000 words, each on 5 frames: a slide deck, not a logo.
        const frames = wordsOnFrames(2000)
        const { result, ms } = timed(() => findPersistentTokens(frames))
        expect(result).toBeNull()
        expect(ms).toBeLessThan(1500)
        await expect(detectChapters(recordedSource(frames))).resolves.toEqual({
            chapters: [],
            candidates: 0,
            coarseFrames: frames.length,
            textHeavy: true,
        })
        // More distinct words than titles and a logo ever have.
        expect(findPersistentTokens(wordsOnFrames(2001, 0))).toBeNull()
    })
})

describe('captionsOf', () => {
    it('keeps a title and drops unsure, short and long lines', () => {
        const captions = captionsOf(
            [
                line('Review'),
                line('SLX Toe Hold y', { confidence: 69, top: 100 }),
                line('Jitsu', { top: 200 }),
                line('Your use of the content either ordered by you from this site', {
                    top: 300,
                }),
            ],
            [],
        )
        expect(captions).toEqual([{ text: 'Review', key: 'review', confidence: 95 }])
    })

    it('drops the logo and the tagline set right under it', () => {
        const persistent = ['samurai']
        expect(
            captionsOf(
                [
                    line('Samurai|Brazilian Jiu Jitsu', { top: 309, height: 39 }),
                    line('SAMURAI', { top: 176, height: 26, confidence: 70 }),
                    line('Brazilian Jiu Jitsu', { top: 203, height: 14, confidence: 89 }),
                ],
                persistent,
            ),
        ).toEqual([])
        // The same words away from the logo are just text.
        expect(
            captionsOf([line('Brazilian Jiu Jitsu Basics', { top: 438 })], persistent),
        ).toHaveLength(1)
    })

    it('joins a title set on two lines, not a smaller speck under it', () => {
        expect(
            captionsOf(
                [
                    line('Inside Sankaku', { top: 476 }),
                    line('SLX Attacks & Transition to', { top: 438 }),
                    line('h', { top: 512, height: 16 }),
                ],
                [],
            ),
        ).toEqual([
            {
                text: 'SLX Attacks & Transition to Inside Sankaku',
                key: 'slx attacks transition to inside sankaku',
                confidence: 95,
            },
        ])
    })

    it('drops a banner that says the same thing twice, not a title repeating a word', () => {
        // Seen on a gym wall and a T-shirt in «Octopus 2.0 · Vol 3 · часть 6».
        for (const banner of ['JIU-JITSU | JIU-JITSU', 'CLUB CLUE']) {
            expect(captionsOf([line(banner)], [])).toEqual([])
        }
        for (const title of ['Leg Drag to Leg Lock', 'Knee Cut Pass']) {
            expect(captionsOf([line(title)], [])).toHaveLength(1)
        }
    })

    it('drops a line without letters', () => {
        expect(captionsOf([line('12:45 - 13:10')], [])).toEqual([])
    })

    it('trims the marks OCR reads at the edges', () => {
        expect(captionsOf([line('‘Attacking the Straight Knee Bar |')], [])[0].text).toBe(
            'Attacking the Straight Knee Bar',
        )
        expect(captionsOf([line('What next?')], [])[0].text).toBe('What next?')
    })
})

describe('textsSimilar', () => {
    it('matches misreads and cut-off reads of one title', () => {
        expect(textsSimilar('slx toe hold', 'slx toe hold y')).toBe(true)
        expect(textsSimilar('elevate ir', 'elevate into inside sankaku')).toBe(true)
        expect(textsSimilar('elevate into inside sankaku', 'elevate ir')).toBe(true)
    })

    it('tells different titles apart', () => {
        expect(
            textsSimilar('attacking far leg from half guard', 'attacking the straight knee bar'),
        ).toBe(false)
        expect(textsSimilar('review', 'reverse')).toBe(false)
        // A cut-off read shorter than six characters is the start of anything.
        expect(textsSimilar('hip sc', 'hip scoop into slx')).toBe(true)
        expect(textsSimilar('hip s', 'hip scoop into slx')).toBe(false)
    })
})

describe('bestReading', () => {
    it('prefers the full title to a surer read of its start', () => {
        expect(
            bestReading([
                sighting(537, 'Elevate into Inside Sankaku', 95),
                sighting(540, 'Elevate', 97),
            ]).text,
        ).toBe('Elevate into Inside Sankaku')
    })

    it('lets the frames vote between rival misreads', () => {
        expect(
            bestReading([
                sighting(1, 'Breakdown with Your Leg Inside I', 88),
                sighting(2, 'Breakdown with Your Leg Inside', 96),
                sighting(3, 'Breakdown with Your Leg Inside', 97),
            ]),
        ).toEqual({
            text: 'Breakdown with Your Leg Inside',
            key: 'breakdown with your leg inside',
            confidence: 97,
        })
    })

    it('breaks a tie by confidence, then by length', () => {
        expect(
            bestReading([sighting(1, 'Posting on Head', 90), sighting(2, 'Posting on Hand', 93)])
                .text,
        ).toBe('Posting on Hand')
        expect(
            bestReading([sighting(1, 'Review', 93), sighting(2, 'Reviews', 93)]).text,
        ).toBe('Reviews')
    })
})

describe('findTitleCandidates', () => {
    it('merges nearby sightings of a text and splits distant ones', () => {
        const frames = [
            { atSec: 12, lines: [line('Review')] },
            { atSec: 15, lines: [line('Reviev')] },
            { atSec: 30, lines: [line('Review')] },
        ]
        const candidates = findTitleCandidates(frames, [])
        expect(candidates.map((c) => [c.firstSec, c.lastSec, c.sightings.length])).toEqual([
            [12, 15, 2],
            [30, 30, 1],
        ])
    })
})

describe('refineWindow', () => {
    it('spans the gaps to the coarse frames around the sightings', () => {
        expect(
            refineWindow({ firstSec: 294, lastSec: 297, sightings: [] }),
        ).toEqual({ startSec: 291.5, durationSec: 8, stepSec: DENSE_STEP_SEC })
        expect(refineWindow({ firstSec: 0, lastSec: 0, sightings: [] })).toEqual({
            startSec: 0,
            durationSec: 2.5,
            stepSec: DENSE_STEP_SEC,
        })
    })
})

describe('refineCandidate', () => {
    const candidate = { firstSec: 501, lastSec: 501, sightings: [sighting(501, 'SLX Toe Hold')] }

    it('starts the chapter at the first frame the title is legible', () => {
        expect(
            refineCandidate(
                candidate,
                [
                    { atSec: 501.5, lines: [] },
                    { atSec: 502, lines: [line('SLX Toe Hold ) i', { confidence: 71 })] },
                    { atSec: 502.5, lines: [line('SLX Toe Hold'), line('Review', { top: 100 })] },
                    { atSec: 503, lines: [line('SLX Toe Hold J', { confidence: 90 })] },
                ],
                [],
            ),
        ).toEqual({ positionSec: 502, title: 'SLX Toe Hold' })
    })

    it('drops a title seen in a single frame', () => {
        expect(
            refineCandidate(candidate, [{ atSec: 502.5, lines: [line('SLX Toe Hold')] }], []),
        ).toBeNull()
    })

    it('caps the title at the column length', () => {
        const long = `${'A'.repeat(150)} ${'B'.repeat(150)}`
        const chapter = refineCandidate(
            { firstSec: 0, lastSec: 0, sightings: [sighting(0, long)] },
            [
                { atSec: 0, lines: [line(long)] },
                { atSec: 0.5, lines: [line(long)] },
            ],
            [],
        )
        expect(chapter?.title).toHaveLength(255)
    })
})

describe('finalizeChapters', () => {
    it('orders chapters and drops a returning title and a second chapter at one second', () => {
        expect(
            finalizeChapters([
                { positionSec: 300, title: 'Review' },
                { positionSec: 10, title: 'Attacking Far Leg' },
                { positionSec: 10, title: 'Something Else' },
                { positionSec: 200, title: 'Hip Scoop into SLX' },
                { positionSec: 600, title: 'Hip Scoop into SLX' },
            ]),
        ).toEqual([
            { positionSec: 10, title: 'Attacking Far Leg' },
            { positionSec: 200, title: 'Hip Scoop into SLX' },
            { positionSec: 300, title: 'Review' },
        ])
    })

    it('returns nothing for a single chapter', () => {
        expect(finalizeChapters([{ positionSec: 10, title: 'Review' }])).toEqual([])
    })
})

describe('publishChapters', () => {
    const CHAPTERS = [
        { positionSec: 10, title: 'Attacking Far Leg' },
        { positionSec: 161, title: 'Breaking Opponent to Near Side Hip' },
    ]

    const build = ({ video = [{ id: 'vid-1' }], existing = 0 } = {}) => {
        const calls: string[] = []
        const tx = {
            $queryRaw: jest.fn(async () => {
                calls.push('lock')
                return video
            }),
            videoTimestamp: {
                count: jest.fn(async () => {
                    calls.push('count')
                    return existing
                }),
                createMany: jest.fn(async () => ({ count: CHAPTERS.length })),
            },
        }
        const prisma = { $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) }
        return { prisma, tx, calls }
    }

    it('stores the chapters as automatic ones on a video without chapters', async () => {
        const { prisma, tx, calls } = build()
        await expect(publishChapters(prisma as never, 'vid-1', CHAPTERS, 'ocr')).resolves.toBe(
            'created',
        )
        // The check runs with the video row locked.
        expect(calls).toEqual(['lock', 'count'])
        expect(tx.videoTimestamp.count).toHaveBeenCalledWith({ where: { videoId: 'vid-1' } })
        expect(tx.videoTimestamp.createMany).toHaveBeenCalledWith({
            data: [
                { videoId: 'vid-1', positionSec: 10, title: 'Attacking Far Leg', source: 'ocr' },
                {
                    videoId: 'vid-1',
                    positionSec: 161,
                    title: 'Breaking Opponent to Near Side Hip',
                    source: 'ocr',
                },
            ],
        })
    })

    it('marks chapters heard in the speech as such', async () => {
        const { prisma, tx } = build()
        await publishChapters(prisma as never, 'vid-1', CHAPTERS.slice(0, 1), 'speech')
        expect(tx.videoTimestamp.createMany).toHaveBeenCalledWith({
            data: [
                {
                    videoId: 'vid-1',
                    positionSec: 10,
                    title: 'Attacking Far Leg',
                    source: 'speech',
                },
            ],
        })
    })

    it('never adds to chapters a coach made', async () => {
        const { prisma, tx } = build({ existing: 3 })
        await expect(publishChapters(prisma as never, 'vid-1', CHAPTERS, 'ocr')).resolves.toBe(
            'kept',
        )
        expect(tx.videoTimestamp.createMany).not.toHaveBeenCalled()
    })

    it('leaves a deleted video alone', async () => {
        const { prisma, tx } = build({ video: [] })
        await expect(publishChapters(prisma as never, 'vid-1', CHAPTERS, 'ocr')).resolves.toBe(
            'kept',
        )
        expect(tx.videoTimestamp.count).not.toHaveBeenCalled()
        expect(tx.videoTimestamp.createMany).not.toHaveBeenCalled()
    })
})
