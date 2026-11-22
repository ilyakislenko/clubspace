jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { STAFF_VIEWER } from '../../domains/playlist/services/course-audience'
import { ListMyVideoNotesFeature } from './list-my-video-notes.feature'
import { ListMyVideoNotesHandler } from './list-my-video-notes.handler'

const d = (s: string) => new Date(`2026-01-0${s}T00:00:00Z`)

// Minimal Prisma `where` evaluator for the shapes this handler builds
// (equality, not/in/lte, AND/OR, relation some/none), so the specs check
// which rows actually come back rather than the literal query.
type Row = Record<string, unknown>
const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, cond]) => {
        if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w))
        if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w))
        const value = row[key]
        if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
            return value === cond
        }
        const c = cond as Row
        if ('some' in c) return (value as Row[]).some((r) => matches(r, c.some as Row))
        if ('none' in c) return !(value as Row[]).some((r) => matches(r, c.none as Row))
        if ('in' in c) return (c.in as unknown[]).includes(value)
        if ('not' in c) return value !== c.not
        if ('lte' in c) return value instanceof Date && value <= (c.lte as Date)
        // To-one relation filter (e.g. `course: { ... }`).
        return matches(value as Row, c)
    })

const bookmark = (
    videoId: string,
    label: string,
    note: string,
    day: string,
    deletedAt: Date | null = null,
) => ({
    id: `b-${videoId}-${label}`,
    userId: 'u1',
    videoId,
    workspaceId: 'w1',
    positionSec: 5,
    endSec: null,
    label,
    note,
    createdAt: d(day),
    updatedAt: d(day),
    deletedAt,
})

type Course = {
    id: string
    title: string
    isPublic: boolean
    publishedAt: Date | null
    createdAt: Date
    audience: Row[]
}
const course = (id: string, over: Partial<Course> = {}): Course => ({
    id,
    title: `Course ${id}`,
    isPublic: true,
    publishedAt: d('1'),
    createdAt: d('1'),
    audience: [],
    ...over,
})

const video = (id: string, title: string, courses: Course[] = []) => ({
    id,
    title,
    thumbnailUrl: null,
    duration: 100,
    workspaceId: 'w1',
    courses,
})

const STUDENT = {
    isStaff: false,
    groupIds: new Set(['g-mine']),
    directionIds: new Set<string>(),
    planIds: new Set<string>(),
    rankOrderByLadder: new Map<string, number>(),
}

const build = (
    data: {
        notes?: Row[]
        bookmarks?: Row[]
        videos?: ReturnType<typeof video>[]
        viewer?: unknown
    } = {},
) => {
    const notes = data.notes ?? [
        { userId: 'u1', videoId: 'v1', workspaceId: 'w1', text: 'Remember the underhook', updatedAt: d('2') },
        // Cleared note (tombstone) — nothing to show.
        { userId: 'u1', videoId: 'v4', workspaceId: 'w1', text: '', updatedAt: d('9') },
    ]
    const bookmarks = data.bookmarks ?? [
        bookmark('v2', 'Sweep', 'knee shield', '5'),
        bookmark('v3', 'Entry', '', '3'),
        // Deleted bookmark (tombstone) on an otherwise empty video.
        bookmark('v5', 'Gone', 'gone', '8', d('8')),
    ]
    const videos = data.videos ?? [
        video('v1', 'Half guard', [course('c1', { title: 'Basics' })]),
        video('v2', 'Butterfly'),
        video('v3', 'Leg locks'),
        video('v4', 'Cleared'),
        video('v5', 'Deleted'),
    ]
    const prisma = {
        videoNote: {
            findMany: jest.fn(async ({ where }) => notes.filter((n) => matches(n, where))),
        },
        videoBookmark: {
            findMany: jest.fn(async ({ where }) =>
                bookmarks.filter((b) => matches(b, where)),
            ),
        },
        video: {
            findMany: jest.fn(async ({ where, select }) =>
                videos
                    .filter((v) => matches(v, where))
                    .map((v) => ({
                        ...v,
                        courses: v.courses
                            .filter((c) => matches({ course: c }, select.courses.where))
                            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                            .slice(0, select.courses.take)
                            .map((c) => ({ course: { id: c.id, title: c.title } })),
                    })),
            ),
        },
    }
    const courseAccess = {
        loadViewer: jest.fn().mockResolvedValue(data.viewer ?? STUDENT),
    }
    return { prisma, courseAccess }
}

const run = (deps: ReturnType<typeof build>, q?: string, isStaff = false) =>
    new ListMyVideoNotesHandler(
        deps.prisma as never,
        deps.courseAccess as never,
    ).execute(new ListMyVideoNotesFeature('u1', 'w1', { q }, isStaff))

describe('ListMyVideoNotesHandler', () => {
    it('lists only videos with a note or live bookmark, newest activity first', async () => {
        const deps = build()
        const res = await run(deps)
        // v4 (cleared note) and v5 (deleted bookmark) have nothing left.
        expect(res.items.map((i) => i.video.id)).toEqual(['v2', 'v3', 'v1'])
        expect(res.items[2]).toMatchObject({
            course: { id: 'c1', title: 'Basics' },
            note: { text: 'Remember the underhook' },
            bookmarks: [],
        })
        expect(res.items[0].bookmarks).toEqual([
            expect.objectContaining({ label: 'Sweep', deleted: false }),
        ])
    })

    it('returns nothing without querying videos when the user has no study data', async () => {
        const deps = build({ notes: [], bookmarks: [] })
        expect(await run(deps)).toEqual({ items: [] })
        expect(deps.prisma.video.findMany).not.toHaveBeenCalled()
    })

    it.each([
        ['video title', 'LEG', ['v3']],
        ['note text', 'underhook', ['v1']],
        ['bookmark label', 'sweep', ['v2']],
        ['bookmark note', 'Knee Shield', ['v2']],
        ['nothing', 'kimura', []],
        ['tombstoned data', 'gone', []],
    ])('searches by %s case-insensitively', async (_, q, ids) => {
        const res = await run(build(), q)
        expect(res.items.map((i) => i.video.id)).toEqual(ids)
    })

    describe('course pick', () => {
        const onlyVideo = (courses: Course[], viewer?: unknown) =>
            build({
                notes: [
                    { userId: 'u1', videoId: 'v1', workspaceId: 'w1', text: 'n', updatedAt: d('2') },
                ],
                bookmarks: [],
                videos: [video('v1', 'Half guard', courses)],
                viewer,
            })
        const pick = async (deps: ReturnType<typeof build>, isStaff = false) =>
            (await run(deps, undefined, isStaff)).items[0].course?.id ?? null

        it('skips a draft (unpublished) course', async () => {
            const deps = onlyVideo([
                course('draft', { publishedAt: null, createdAt: d('1') }),
                course('pub', { createdAt: d('2') }),
            ])
            expect(await pick(deps)).toBe('pub')
        })

        it('skips a course scheduled for later', async () => {
            const deps = onlyVideo([course('later', { publishedAt: new Date('2999-01-01') })])
            expect(await pick(deps)).toBeNull()
        })

        it("skips a course hidden by a group audience the student isn't in", async () => {
            const deps = onlyVideo([
                course('kids', { audience: [{ kind: 'GROUP', groupId: 'g-other' }] }),
            ])
            expect(await pick(deps)).toBeNull()
        })

        it("picks a group course the student is in", async () => {
            const deps = onlyVideo([
                course('mine', { audience: [{ kind: 'GROUP', groupId: 'g-mine' }] }),
            ])
            expect(await pick(deps)).toBe('mine')
        })

        it('picks a published course even when isPublic is false', async () => {
            const deps = onlyVideo([course('c', { isPublic: false })])
            expect(await pick(deps)).toBe('c')
        })

        it('lets staff see drafts and every audience', async () => {
            const deps = onlyVideo(
                [
                    course('draft', {
                        publishedAt: null,
                        audience: [{ kind: 'GROUP', groupId: 'g-other' }],
                    }),
                ],
                STAFF_VIEWER,
            )
            expect(await pick(deps, true)).toBe('draft')
            expect(deps.courseAccess.loadViewer).toHaveBeenCalledWith({
                workspaceId: 'w1',
                userId: 'u1',
                isStaff: true,
            })
        })
    })
})
