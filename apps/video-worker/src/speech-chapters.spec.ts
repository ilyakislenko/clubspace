import {
    buildChapterPrompt,
    describeVideo,
    formatClock,
    hasSpeech,
    maxSpeechChapters,
    mergeShortest,
    NOT_A_CHAPTER_LIST,
    parseChapterAnswer,
    parseClock,
    parseWhisperJson,
    retryMessages,
    type Transcript,
    whisperPrompt,
} from './speech-chapters'

const CONTEXT = {
    videoTitle: 'Craig Jones Shows the Perfect Kimura',
    courses: [
        { title: 'Kimura', lessonTitle: null },
        { title: 'Upper Body Submissions', lessonTitle: 'Kimura from Side Control' },
    ],
}

// A lesson's transcript: a segment every 15 s for ten minutes.
const LESSON: Transcript = {
    language: 'en',
    segments: Array.from({ length: 40 }, (_, idx) => ({
        startSec: idx * 15,
        endSec: idx * 15 + 15,
        text: `so here we grip the collar and pull him into the guard number ${idx}`,
    })),
}

const answer = (chapters: unknown) => JSON.stringify({ chapters })

describe('formatClock / parseClock', () => {
    it('writes minutes and seconds, hours when there are some', () => {
        expect(formatClock(0)).toBe('00:00')
        expect(formatClock(75.9)).toBe('01:15')
        expect(formatClock(3725)).toBe('1:02:05')
    })

    it('reads the shapes a model answers with', () => {
        expect(parseClock(75)).toBe(75)
        expect(parseClock('75')).toBe(75)
        expect(parseClock('01:15')).toBe(75)
        expect(parseClock('[1:02:05]')).toBe(3725)
        expect(parseClock('01:15.5')).toBe(75)
    })

    it('reads nothing else', () => {
        expect(parseClock('soon')).toBeNull()
        expect(parseClock(Number.NaN)).toBeNull()
        expect(parseClock(null)).toBeNull()
    })
})

describe('parseWhisperJson', () => {
    it('reads timed segments and the detected language, without non-speech markers', () => {
        const json = JSON.stringify({
            result: { language: 'ru' },
            transcription: [
                { offsets: { from: 0, to: 4200 }, text: ' [BLANK_AUDIO]' },
                { offsets: { from: 4200, to: 9800 }, text: ' Сегодня  разберём (смеётся) ♪ гард' },
                { offsets: { from: 9800 }, text: ' без конца' },
                { text: ' без времени' },
            ],
        })
        expect(parseWhisperJson(json)).toEqual({
            language: 'ru',
            segments: [{ startSec: 4.2, endSec: 9.8, text: 'Сегодня разберём гард' }],
        })
    })

    it('drops the sentence Whisper loops over a clip without speech', () => {
        // «Выход из маунта «мостом»»: music only, one invented line repeated.
        const json = JSON.stringify({
            result: { language: 'en' },
            transcription: Array.from({ length: 16 }, (_, idx) => ({
                offsets: { from: idx * 1000, to: idx * 1000 + 1000 },
                text: " Be careful, don't overdo it, be careful.",
            })),
        })
        const transcript = parseWhisperJson(json)
        expect(transcript.segments).toEqual([
            { startSec: 0, endSec: 1, text: "Be careful, don't overdo it, be careful." },
        ])
        expect(hasSpeech(transcript)).toBe(false)
    })

    it('drops segments that only echo the prompt Whisper was given', () => {
        const json = JSON.stringify({
            transcription: [
                { offsets: { from: 0, to: 6000 }, text: ' 5. Octopus' },
                { offsets: { from: 6000, to: 11000 }, text: ' 6. Octopus, часть' },
                { offsets: { from: 11000, to: 16000 }, text: ' The octopus guard starts here' },
            ],
        })
        expect(parseWhisperJson(json, 'Octopus, часть').segments).toEqual([
            { startSec: 11, endSec: 16, text: 'The octopus guard starts here' },
        ])
        // Without a prompt nothing is an echo.
        expect(parseWhisperJson(json).segments).toHaveLength(3)
    })

    it('has no language when Whisper did not detect one', () => {
        expect(parseWhisperJson(JSON.stringify({ result: { language: 'auto' } }))).toEqual({
            language: null,
            segments: [],
        })
        expect(parseWhisperJson('{}').language).toBeNull()
    })
})

describe('hasSpeech', () => {
    it('wants a lesson’s worth of words, not a few over music', () => {
        expect(hasSpeech(LESSON)).toBe(true)
        expect(
            hasSpeech({
                language: 'en',
                segments: [{ startSec: 0, endSec: 3, text: 'Thank you for watching.' }],
            }),
        ).toBe(false)
    })
})

describe('maxSpeechChapters', () => {
    it('allows a chapter a minute, and three on a short clip', () => {
        expect(maxSpeechChapters(600)).toBe(10)
        expect(maxSpeechChapters(90)).toBe(3)
    })
})

describe('describeVideo / whisperPrompt', () => {
    it('names the video and its courses', () => {
        expect(describeVideo(CONTEXT)).toEqual([
            'Video title: Craig Jones Shows the Perfect Kimura',
            'Course: Kimura',
            'Course: Upper Body Submissions (lesson: Kimura from Side Control)',
        ])
    })

    it('gives Whisper the titles’ words, without numbers, short words or repeats', () => {
        expect(whisperPrompt(CONTEXT)).toBe(
            'Craig, Jones, Shows, Perfect, Kimura, Upper, Body, Submissions, from, Side, Control',
        )
        expect(
            whisperPrompt({
                videoTitle: 'Octopus 2.0 · Vol 2 · часть 7',
                courses: [{ title: 'Octopus 2.0', lessonTitle: null }],
            }),
        ).toBe('Octopus, часть')
        // About 200 tokens: a six-letter Latin word is 2 plus a separator.
        const many = Array.from(
            { length: 100 },
            (_, idx) =>
                `term${String.fromCharCode(97 + Math.floor(idx / 26))}${String.fromCharCode(97 + (idx % 26))}`,
        )
        expect(whisperPrompt({ videoTitle: many.join(' '), courses: [] }).split(', ')).toHaveLength(66)
    })

    it('adds the glossary terms that share a word with the titles', () => {
        expect(
            whisperPrompt(
                {
                    videoTitle: 'Octopus 2.0 · Vol 4 · часть 3',
                    courses: [{ title: 'Octopus 2.0', lessonTitle: null }],
                },
                ['Kimura', 'Octopus Guard', '50/50 Octopus', 'Armbar'],
            ),
        ).toBe('Octopus, часть, Octopus Guard')
    })
})

describe('retryMessages', () => {
    it('replays the answer and spells out the shape', () => {
        const [assistant, user] = retryMessages('Sure! Here are the chapters: ...')
        expect(assistant).toEqual({ role: 'assistant', content: 'Sure! Here are the chapters: ...' })
        expect(user.role).toBe('user')
        expect(user.content).toContain('{"chapters":[{"start":"mm:ss","title":"..."}]}')
    })
})

describe('mergeShortest', () => {
    const CHAPTERS = [
        { positionSec: 0, title: 'Cross Face Introduction' },
        { positionSec: 24, title: 'Applying Cross Face' },
        { positionSec: 67, title: 'Hip Control' },
        { positionSec: 100, title: 'Cross Face in Half Guard' },
        { positionSec: 120, title: 'Wrestling Style Cross Face' },
        { positionSec: 153, title: 'Extending with Cross Face' },
        { positionSec: 200, title: 'Unlearning Jiu Jitsu Fundamentals' },
    ]

    it('folds the shortest chapters into neighbours until few enough remain', () => {
        // «Octopus 2.0 · Vol 1 · часть 3», 3:33: the model proposed 7, 5 fit.
        expect(mergeShortest(CHAPTERS, 213, 5)).toEqual([
            { positionSec: 0, title: 'Cross Face Introduction' },
            { positionSec: 24, title: 'Applying Cross Face' },
            { positionSec: 67, title: 'Hip Control' },
            { positionSec: 120, title: 'Wrestling Style Cross Face' },
            { positionSec: 153, title: 'Extending with Cross Face' },
        ])
    })

    it('keeps the earlier start and the title with fewer words, else of the longer part', () => {
        expect(
            mergeShortest(
                [
                    { positionSec: 0, title: 'Kimura Grip Details' },
                    { positionSec: 100, title: 'Kimura' },
                    { positionSec: 110, title: 'Finish' },
                ],
                300,
                2,
            ),
        ).toEqual([
            { positionSec: 0, title: 'Kimura' },
            { positionSec: 110, title: 'Finish' },
        ])
        expect(
            mergeShortest(
                [
                    { positionSec: 0, title: 'Grip Fight' },
                    { positionSec: 30, title: 'Guard Pull' },
                    { positionSec: 200, title: 'Sweep Setup' },
                ],
                300,
                2,
            ),
        ).toEqual([
            { positionSec: 0, title: 'Guard Pull' },
            { positionSec: 200, title: 'Sweep Setup' },
        ])
    })

    it('merges an end chapter into its only neighbour, and leaves a short list alone', () => {
        expect(
            mergeShortest(
                [
                    { positionSec: 0, title: 'Intro' },
                    { positionSec: 100, title: 'Long Part' },
                    { positionSec: 290, title: 'Outro' },
                ],
                300,
                2,
            ),
        ).toEqual([
            { positionSec: 0, title: 'Intro' },
            { positionSec: 100, title: 'Outro' },
        ])
        expect(mergeShortest(CHAPTERS.slice(0, 2), 213, 5)).toEqual(CHAPTERS.slice(0, 2))
    })
})

describe('buildChapterPrompt', () => {
    it('asks for JSON chapters in the instructor’s language over the timed transcript', () => {
        const [system, user] = buildChapterPrompt(LESSON, 600, CONTEXT)
        expect(system.role).toBe('system')
        expect(system.content).toContain('Write the titles in English')
        expect(system.content).toContain('often mishears technique names')
        expect(system.content).toContain('Between 2 and 10 chapters, at least 20 seconds apart')
        expect(system.content).toContain('{"chapters":[{"start":"mm:ss","title":"..."}]}')
        expect(user.role).toBe('user')
        expect(user.content.split('\n').slice(0, 7)).toEqual([
            'Video title: Craig Jones Shows the Perfect Kimura',
            'Course: Kimura',
            'Course: Upper Body Submissions (lesson: Kimura from Side Control)',
            'Video length: 10:00',
            'Transcript:',
            '[00:00] so here we grip the collar and pull him into the guard number 0',
            '[00:15] so here we grip the collar and pull him into the guard number 1',
        ])
    })

    it('asks for Russian titles over a Russian lesson and takes them as they come', () => {
        const russian: Transcript = {
            language: 'ru',
            segments: Array.from({ length: 12 }, (_, idx) => ({
                startSec: idx * 15,
                endSec: idx * 15 + 15,
                text: `соперник в маунте, упираемся в бедро и делаем мост номер ${idx}`,
            })),
        }
        const context = {
            videoTitle: 'Выход из маунта «мостом»',
            courses: [{ title: 'БЖЖ: база белого пояса', lessonTitle: null }],
        }
        const [system, user] = buildChapterPrompt(russian, 180, context)
        expect(system.content).toContain('Write the titles in Russian, the language the instructor speaks.')
        expect(user.content).toContain('Video title: Выход из маунта «мостом»')
        expect(user.content).toContain('[00:15] соперник в маунте')
        expect(whisperPrompt(context)).toBe('Выход, маунта, мостом, база, белого, пояса')
        expect(
            parseChapterAnswer(
                answer([
                    { start: '00:00', title: '«Удержание в маунте»' },
                    { start: '01:00', title: 'Часть 2' },
                    { start: '01:30', title: 'Выход мостом' },
                ]),
                russian,
                180,
            ).chapters,
        ).toEqual([
            { positionSec: 0, title: 'Удержание в маунте' },
            { positionSec: 90, title: 'Выход мостом' },
        ])
    })

    it('lists the sport’s technique names in the transcript’s script', () => {
        const vocabulary = ['Kimura', 'Americana', 'кимура', 'омоплата']
        const [english] = buildChapterPrompt(LESSON, 600, CONTEXT, vocabulary)
        expect(english.content).toContain(
            '- Technique names of this sport, spelled right: Kimura, Americana.',
        )
        const [russian] = buildChapterPrompt({ ...LESSON, language: 'ru' }, 600, CONTEXT, vocabulary)
        expect(russian.content).toContain('spelled right: кимура, омоплата.')
        const [none] = buildChapterPrompt(LESSON, 600, CONTEXT)
        expect(none.content).not.toContain('Technique names of this sport')
    })

    it('falls back to the transcript’s language when it is unknown', () => {
        for (const language of [null, 'not a language code']) {
            const [system] = buildChapterPrompt({ ...LESSON, language }, 600, CONTEXT)
            expect(system.content).toContain(
                'Write the titles in the language the instructor speaks.',
            )
        }
    })
})

describe('parseChapterAnswer', () => {
    it('snaps each start to the nearest segment and orders the chapters', () => {
        expect(
            parseChapterAnswer(
                answer([
                    { start: '04:58', title: 'Knee Cut Pass' },
                    { start: '00:00', title: 'Introduction' },
                    { start: '01:37', title: 'Collar Grip Setup' },
                ]),
                LESSON,
                600,
            ),
        ).toEqual({
            chapters: [
                { positionSec: 0, title: 'Introduction' },
                { positionSec: 90, title: 'Collar Grip Setup' },
                { positionSec: 300, title: 'Knee Cut Pass' },
            ],
        })
    })

    it('reads a bare list, another key, other field names, fenced or chatty JSON', () => {
        const items = [
            { time: 0, name: 'Intro' },
            { timestamp: '[02:00]', title: 'Guard Pull' },
        ]
        const expected = [
            { positionSec: 0, title: 'Intro' },
            { positionSec: 120, title: 'Guard Pull' },
        ]
        for (const content of [
            JSON.stringify(items),
            JSON.stringify({ sections: items }),
            `Sure!\n\`\`\`json\n${answer(items)}\n\`\`\``,
            `Here you go: ${answer(items)} Enjoy.`,
        ]) {
            expect(parseChapterAnswer(content, LESSON, 600).chapters).toEqual(expected)
        }
    })

    it('cleans numbering and quotes off titles and drops unusable items', () => {
        expect(
            parseChapterAnswer(
                answer([
                    { start: '00:00', title: '1. "Introduction"' },
                    { start: '02:00', title: 'Chapter 2: Collar Grip' },
                    'not an item',
                    null,
                    { start: 'later', title: 'No Time' },
                    { start: '03:00', title: '   ' },
                    { start: '04:00', title: 42 },
                    {
                        start: '05:00',
                        title: 'here the instructor keeps talking about many different things at once',
                    },
                    { start: '-00:10', title: 'Negative' },
                    { start: '10:00', title: 'Past The End' },
                ]),
                LESSON,
                600,
            ).chapters,
        ).toEqual([
            { positionSec: 0, title: 'Introduction' },
            { positionSec: 120, title: 'Collar Grip' },
        ])
    })

    it('strips control and format characters and Markdown from titles', () => {
        expect(
            parseChapterAnswer(
                answer([
                    { start: '00:00', title: '**Knee\u0000Cut**\tPass' },
                    { start: '02:00', title: '`Kimura` \u202Etrap\u202C _from_ guard' },
                    { start: '04:00', title: '~~Old~~ Arm_Drag' },
                ]),
                LESSON,
                600,
            ).chapters.map((chapter) => chapter.title),
        ).toEqual(['Knee Cut Pass', 'Kimura trap from guard', 'Old Arm_Drag'])
    })

    it('drops repeats, and a chapter too short gives way to the next', () => {
        expect(
            parseChapterAnswer(
                answer([
                    { start: '00:00', title: 'Introduction' },
                    { start: '00:15', title: 'Octopus Entry' },
                    { start: '01:00', title: 'Guard Pull' },
                    { start: '01:02', title: 'Same Moment' },
                    { start: '03:00', title: 'guard pull' },
                    { start: '04:00', title: 'Sweep' },
                ]),
                LESSON,
                600,
            ).chapters,
        ).toEqual([
            { positionSec: 15, title: 'Octopus Entry' },
            { positionSec: 60, title: 'Guard Pull' },
            { positionSec: 240, title: 'Sweep' },
        ])
    })

    it('caps a title at the column length', () => {
        const long = `${'a'.repeat(200)} ${'b'.repeat(200)}`
        const { chapters } = parseChapterAnswer(
            answer([
                { start: '00:00', title: 'Introduction' },
                { start: '02:00', title: long },
            ]),
            LESSON,
            600,
        )
        expect(chapters[1].title).toHaveLength(255)
    })

    it('merges more than half again the chapters asked for, and needs two', () => {
        expect(
            parseChapterAnswer(answer([{ start: '00:00', title: 'Whole Lesson' }]), LESSON, 600),
        ).toEqual({
            chapters: [],
            rejected: '1 usable chapter(s) of 1 proposed',
        })
        const proposals = (count: number) =>
            answer(
                Array.from({ length: count }, (_, idx) => ({
                    start: formatClock(idx * 30),
                    title: `Technique ${String.fromCharCode(65 + idx)}`,
                })),
            )
        // Ten asked for in ten minutes, up to 15 taken as they are.
        expect(parseChapterAnswer(proposals(15), LESSON, 600).chapters).toHaveLength(15)
        expect(parseChapterAnswer(proposals(18), LESSON, 600).chapters).toHaveLength(15)
    })

    it('drops numbered placeholders instead of names', () => {
        // «Octopus 2.0 · Vol 2 · часть 7» with a hallucinated transcript.
        expect(
            parseChapterAnswer(
                answer([
                    { start: '00:00', title: 'Introduction' },
                    { start: '00:30', title: 'Technique 7' },
                    { start: '01:00', title: 'Часть 2' },
                    { start: '01:30', title: 'Part #3' },
                    { start: '02:00', title: 'Guard Pull' },
                ]),
                LESSON,
                600,
            ).chapters,
        ).toEqual([
            { positionSec: 0, title: 'Introduction' },
            { positionSec: 120, title: 'Guard Pull' },
        ])
    })

    it('takes a JSON object without a list for an empty one', () => {
        for (const content of ['{}', '{"chapters": 3}']) {
            expect(parseChapterAnswer(content, LESSON, 600)).toEqual({
                chapters: [],
                rejected: '0 usable chapter(s) of 0 proposed',
            })
        }
    })

    it('marks an answer that is not JSON at all, for a retry', () => {
        for (const content of ['I cannot help with that.', '"text"', 'null']) {
            expect(parseChapterAnswer(content, LESSON, 600)).toEqual({
                chapters: [],
                rejected: NOT_A_CHAPTER_LIST,
            })
        }
    })

    it('gives none without a transcript to snap to', () => {
        expect(
            parseChapterAnswer(
                answer([{ start: '00:00', title: 'Intro' }]),
                { language: 'en', segments: [] },
                600,
            ),
        ).toEqual({ chapters: [], rejected: 'empty transcript' })
    })
})
