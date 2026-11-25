import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

import {
    canSetStatus,
    displayStatus,
    isValidCommentRange,
    reviewClipKeys,
    reviewClipTokenSubject,
} from './video-reviews-utils'

describe('displayStatus', () => {
    it.each([
        ['uploading', 'open', 'uploading'],
        ['uploaded', 'open', 'processing'],
        ['processing', 'open', 'processing'],
        ['failed', 'open', 'failed'],
        ['ready', 'open', 'open'],
        ['ready', 'answered', 'answered'],
        ['ready', 'closed', 'closed'],
    ])('clip %s + request %s → %s', (clip, request, shown) => {
        expect(displayStatus(clip, request)).toBe(shown)
    })
})

describe('canSetStatus', () => {
    it('lets staff set any status and the member everything but «answered»', () => {
        for (const next of ['open', 'answered', 'closed'] as const) {
            expect(canSetStatus('staff', next)).toBe(true)
        }
        expect(canSetStatus('owner', 'closed')).toBe(true)
        expect(canSetStatus('owner', 'open')).toBe(true)
        expect(canSetStatus('owner', 'answered')).toBe(false)
    })
})

describe('isValidCommentRange', () => {
    it.each([
        [5, null, true],
        [5, 6, true],
        [5, 5, false],
        [5, 1, false],
    ])('%i–%p → %p', (at, end, ok) => {
        expect(isValidCommentRange(at, end)).toBe(ok)
    })
})

describe('clip storage and tokens', () => {
    it('keeps every file of a clip under its own private prefixes', () => {
        expect(reviewClipKeys('c1')).toEqual({
            rawPrefix: 'raw/review/c1/',
            rawKey: 'raw/review/c1/source',
            hlsPrefix: 'hls/review/c1/',
        })
    })

    it('binds a playback token to the clip, never to a bare uuid', () => {
        expect(reviewClipTokenSubject('c1')).toBe('review-c1')
    })
})

// Member clips must never reach club content. They live in their own tables,
// so the guard is simply: nothing outside «Разбор видео» (and the staff
// requests inbox, the account purge, and the member's own data export) reads
// them — and «Разбор видео» never reads the club's `Video`.
describe('member clips stay out of club content', () => {
    const SRC = join(__dirname, '..', '..')
    const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const full = join(dir, name)
            if (name === 'generated' || name === 'node_modules') return []
            return statSync(full).isDirectory() ? walk(full) : [full]
        })
    const sources = walk(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))

    it('only the review feature, the staff requests inbox, the account purge and the own-data export touch the review tables', () => {
        const touching = sources
            .filter((f) =>
                /\.(reviewClip|videoReviewRequest|videoReviewComment)\b|"ReviewClip"/.test(
                    readFileSync(f, 'utf8'),
                ),
            )
            .map((f) => relative(SRC, f))
            .filter((f) => !f.startsWith('features/video-reviews/'))
        expect(touching).toEqual([
            // The demo generator: student@'s placeholder review (no media).
            'domains/demo/demo-club.writer.ts',
            // «Заявки»: counts and lists open reviews for staff, no club content.
            'domains/requests/open-requests.ts',
            'domains/users/services/users.service.ts',
            'features/export-my-data/export-my-data.handler.ts',
        ])
    })

    it('the review feature never reads the club video table', () => {
        const reading = sources
            .filter((f) => relative(SRC, f).startsWith('features/video-reviews/'))
            .filter((f) => /\.video\.|"Video"/.test(readFileSync(f, 'utf8')))
        expect(reading).toEqual([])
    })
})
