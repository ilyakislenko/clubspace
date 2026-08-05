import { findActiveCue, parseVtt } from './subtitle-vtt'

describe('parseVtt', () => {
    it('parses a minimal WEBVTT cue', () => {
        const raw = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world
`
        expect(parseVtt(raw)).toEqual([
            { start: 1, end: 4, text: 'Hello world' },
        ])
    })

    it('supports timestamps without an hour part', () => {
        const raw = `WEBVTT

00:01.500 --> 00:02.500
Short cue
`
        expect(parseVtt(raw)).toEqual([
            { start: 1.5, end: 2.5, text: 'Short cue' },
        ])
    })

    it('strips HTML-style tags from cue text', () => {
        const raw = `WEBVTT

00:00:00.000 --> 00:00:02.000
<c.italic>Tagged</c> text
`
        expect(parseVtt(raw)).toEqual([
            { start: 0, end: 2, text: 'Tagged text' },
        ])
    })

    it('skips blocks without a timestamp line', () => {
        // SRT-style "1\n00:00..." or stray NOTE blocks shouldn't crash
        // the parser — they're ignored and remaining cues still parse.
        const raw = `WEBVTT

NOTE this is a note

00:00:01.000 --> 00:00:02.000
Cue one
`
        expect(parseVtt(raw)).toEqual([
            { start: 1, end: 2, text: 'Cue one' },
        ])
    })

    it('keeps cues in source order', () => {
        const raw = `WEBVTT

00:00:01.000 --> 00:00:02.000
First

00:00:02.500 --> 00:00:03.500
Second
`
        const cues = parseVtt(raw)
        expect(cues.map((c) => c.text)).toEqual(['First', 'Second'])
    })
})

describe('findActiveCue', () => {
    const cues = [
        { start: 0, end: 2, text: 'A' },
        { start: 5, end: 7, text: 'B' },
    ]

    it('returns the cue covering the given time', () => {
        expect(findActiveCue(cues, 1)?.text).toBe('A')
        expect(findActiveCue(cues, 6)?.text).toBe('B')
    })

    it('treats start and end as inclusive', () => {
        expect(findActiveCue(cues, 0)?.text).toBe('A')
        expect(findActiveCue(cues, 2)?.text).toBe('A')
    })

    it('returns null in gaps and outside the range', () => {
        expect(findActiveCue(cues, 3)).toBeNull()
        expect(findActiveCue(cues, 100)).toBeNull()
    })
})
