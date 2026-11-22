jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { STAFF_VIEWER } from '../../domains/playlist/services/course-audience'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ListMyReviewsFeature, MY_REVIEWS_LIMIT } from './list-my-reviews.feature'
import { ListMyReviewsHandler } from './list-my-reviews.handler'
import { ReviewMyBookmarkFeature } from './review-my-bookmark.feature'
import { ReviewMyBookmarkHandler } from './review-my-bookmark.handler'

const NOW = new Date('2026-03-10T12:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs)

beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
})
afterEach(() => jest.restoreAllMocks())

type Review = {
    bookmarkId: string
    dueAt: Date
    intervalDays: number
    ease: number
    reps: number
    lapses: number
    lastReviewedAt: Date
}

type Bookmark = {
    id: string
    userId: string
    videoId: string
    workspaceId: string
    positionSec: number
    endSec: number | null
    label: string
    note: string
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
    review: Review | null
}

const BM = '11111111-1111-4111-8111-111111111111'

const bookmark = (over: Partial<Bookmark> = {}): Bookmark => ({
    id: BM,
    userId: 'u1',
    videoId: 'v1',
    workspaceId: 'w1',
    positionSec: 30,
    endSec: null,
    label: 'Sweep',
    note: 'hip out',
    createdAt: at(-3 * DAY),
    updatedAt: at(-3 * DAY),
    deletedAt: null,
    review: null,
    ...over,
})

const review = (over: Partial<Review> = {}): Review => ({
    bookmarkId: BM,
    dueAt: at(-HOUR),
    intervalDays: 10,
    ease: 2.5,
    reps: 3,
    lapses: 0,
    lastReviewedAt: at(-10 * DAY),
    ...over,
})

const membershipPrisma = (o: { membership?: unknown; ownerId?: string | null }) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: o.ownerId ?? null }),
    },
    workspaceMember: {
        findUnique: jest
            .fn()
            .mockResolvedValue(
                o.membership === undefined
                    ? { status: 'ACTIVE', accessUntil: null }
                    : o.membership,
            ),
    },
})

describe('ListMyReviewsHandler', () => {
    const video = (id: string, course: { id: string; title: string } | null = null) => ({
        id,
        title: `Video ${id}`,
        thumbnailUrl: null,
        duration: 600,
        courses: course ? [{ course }] : [],
    })

    const build = (
        o: {
            bookmarks?: Bookmark[]
            videos?: ReturnType<typeof video>[]
            membership?: unknown
            ownerId?: string | null
            // Lessons the member may not watch right now.
            unwatchable?: string[]
        } = {},
    ) => {
        const rows = o.bookmarks ?? []
        const prisma = {
            ...membershipPrisma(o),
            videoBookmark: {
                // Honours the filter the handler sends.
                findMany: jest.fn(async ({ where }) =>
                    rows.filter(
                        (b) =>
                            b.userId === where.userId &&
                            b.workspaceId === where.workspaceId &&
                            (where.deletedAt !== null || b.deletedAt === null),
                    ),
                ),
            },
            video: {
                findMany: jest.fn(async ({ where }) =>
                    (o.videos ?? [video('v1'), video('v2'), video('v3')]).filter((v) =>
                        where.id.in.includes(v.id),
                    ),
                ),
            },
        }
        const courseAccess = {
            loadViewer: jest.fn().mockResolvedValue(STAFF_VIEWER),
            watchableVideoIds: jest.fn(
                async (_ws: string, _user: string, ids: readonly string[]) =>
                    new Set(ids.filter((id) => !(o.unwatchable ?? []).includes(id))),
            ),
        }
        return { prisma, courseAccess }
    }

    const run = (deps: ReturnType<typeof build>, isStaff = false) =>
        new ListMyReviewsHandler(
            deps.prisma as never,
            deps.courseAccess as never,
        ).execute(new ListMyReviewsFeature('u1', 'w1', isStaff))

    it("refuses a user who isn't an active member of the club", async () => {
        const deps = build({ membership: null })
        await expect(run(deps)).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.videoBookmark.findMany).not.toHaveBeenCalled()
    })

    it('lets the owner (no member row) in', async () => {
        const deps = build({ membership: null, ownerId: 'u1' })
        await expect(run(deps)).resolves.toMatchObject({ items: [] })
    })

    it('lists due cards oldest-due first; new cards are due a day after saving', async () => {
        const deps = build({
            bookmarks: [
                // Reviewed, due an hour ago.
                bookmark({ id: 'a', review: review({ bookmarkId: 'a' }) }),
                // New, saved 3 days ago → due 2 days ago.
                bookmark({ id: 'b', videoId: 'v2' }),
                // New, saved 2 hours ago → due tomorrow.
                bookmark({ id: 'c', createdAt: at(-2 * HOUR) }),
                // Reviewed, due in 3 days.
                bookmark({
                    id: 'd',
                    review: review({ bookmarkId: 'd', dueAt: at(3 * DAY) }),
                }),
                // Due in 10 days — beyond the upcoming window.
                bookmark({
                    id: 'e',
                    review: review({ bookmarkId: 'e', dueAt: at(10 * DAY) }),
                }),
                // Deleted on some device: never reviewed again.
                bookmark({ id: 'f', deletedAt: at(-DAY) }),
                // Another user's.
                bookmark({ id: 'g', userId: 'u2' }),
            ],
        })
        const res = await run(deps)
        expect(res.items.map((i) => i.bookmark.id)).toEqual(['b', 'a'])
        expect(res).toMatchObject({
            dueCount: 2,
            upcomingCount: 2,
            nextDueAt: at(-2 * HOUR + DAY).toISOString(),
            totalCount: 5,
        })
    })

    it('returns the card with its lesson, course, schedule and grade hints', async () => {
        const deps = build({
            bookmarks: [
                bookmark({ endSec: 45, review: review() }),
                bookmark({ id: 'n', videoId: 'v2' }),
            ],
            videos: [video('v1', { id: 'c1', title: 'Basics' }), video('v2')],
        })
        const res = await run(deps, true)
        expect(deps.courseAccess.loadViewer).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            isStaff: true,
        })
        const [fresh, learned] = res.items
        expect(learned).toEqual({
            bookmark: expect.objectContaining({
                id: BM,
                positionSec: 30,
                endSec: 45,
                label: 'Sweep',
                note: 'hip out',
                deleted: false,
            }),
            video: { id: 'v1', title: 'Video v1', thumbnailUrl: null, duration: 600 },
            course: { id: 'c1', title: 'Basics' },
            schedule: {
                bookmarkId: BM,
                dueAt: at(-HOUR).toISOString(),
                intervalDays: 10,
                ease: 2.5,
                reps: 3,
                lapses: 0,
                lastReviewedAt: at(-10 * DAY).toISOString(),
            },
            nextIntervals: { again: 0, hard: 12, good: 25, easy: 33 },
        })
        expect(fresh).toMatchObject({
            course: null,
            schedule: { reps: 0, lastReviewedAt: null, dueAt: at(-2 * DAY).toISOString() },
            nextIntervals: { again: 0, hard: 1, good: 2, easy: 4 },
        })
    })

    it(`caps the list at ${MY_REVIEWS_LIMIT} but counts every due card`, async () => {
        const many = Array.from({ length: MY_REVIEWS_LIMIT + 5 }, (_, i) =>
            bookmark({ id: `b${String(i).padStart(2, '0')}`, createdAt: at(-(40 - i) * DAY) }),
        )
        const res = await run(build({ bookmarks: many }))
        expect(res.items).toHaveLength(MY_REVIEWS_LIMIT)
        expect(res.items[0].bookmark.id).toBe('b00')
        expect(res.dueCount).toBe(MY_REVIEWS_LIMIT + 5)
    })

    it('skips the lesson query when nothing is due', async () => {
        const deps = build({ bookmarks: [bookmark({ createdAt: at(-HOUR) })] })
        const res = await run(deps)
        expect(res).toEqual({
            items: [],
            dueCount: 0,
            upcomingCount: 1,
            nextDueAt: at(23 * HOUR).toISOString(),
            totalCount: 1,
        })
        expect(deps.prisma.video.findMany).not.toHaveBeenCalled()
        expect(deps.courseAccess.loadViewer).not.toHaveBeenCalled()
    })

    it('reports a member who never saved anything', async () => {
        const res = await run(build())
        expect(res).toEqual({
            items: [],
            dueCount: 0,
            upcomingCount: 0,
            nextDueAt: null,
            totalCount: 0,
        })
    })

    it('drops a card whose lesson is not in this club', async () => {
        const deps = build({ bookmarks: [bookmark()], videos: [] })
        const res = await run(deps)
        expect(res.items).toEqual([])
        expect(res.dueCount).toBe(1)
    })

    it('neither shows nor counts a card whose lesson the member may not watch', async () => {
        const deps = build({
            bookmarks: [
                bookmark({ id: 'open' }),
                // Locked lesson: due, upcoming and later cards all disappear.
                bookmark({ id: 'due', videoId: 'v2' }),
                bookmark({
                    id: 'soon',
                    videoId: 'v2',
                    review: review({ bookmarkId: 'soon', dueAt: at(HOUR) }),
                }),
                bookmark({
                    id: 'later',
                    videoId: 'v2',
                    review: review({ bookmarkId: 'later', dueAt: at(10 * DAY) }),
                }),
            ],
            unwatchable: ['v2'],
        })
        const res = await run(deps)
        expect(deps.courseAccess.watchableVideoIds).toHaveBeenCalledWith('w1', 'u1', [
            'v1',
            'v2',
            'v2',
            'v2',
        ])
        expect(res.items.map((i) => i.bookmark.id)).toEqual(['open'])
        expect(res).toMatchObject({
            dueCount: 1,
            upcomingCount: 0,
            nextDueAt: null,
            totalCount: 1,
        })
    })

    it('lets staff review every lesson without the watch check', async () => {
        const deps = build({
            bookmarks: [bookmark({ id: 'a' }), bookmark({ id: 'b', videoId: 'v2' })],
            unwatchable: ['v2'],
        })
        const res = await run(deps, true)
        expect(deps.courseAccess.watchableVideoIds).not.toHaveBeenCalled()
        expect(res).toMatchObject({ dueCount: 2, totalCount: 2 })
    })
})

describe('ReviewMyBookmarkHandler', () => {
    const build = (
        o: {
            stored?: Bookmark | null
            video?: unknown
            membership?: unknown
            updated?: number
            createError?: unknown
            storedReview?: Review | null
        } = {},
    ) => {
        const prisma = {
            ...membershipPrisma(o),
            video: {
                findUnique: jest
                    .fn()
                    .mockResolvedValue(
                        o.video === undefined ? { id: 'v1', workspaceId: 'w1' } : o.video,
                    ),
            },
            videoBookmark: {
                findUnique: jest
                    .fn()
                    .mockResolvedValue(o.stored === undefined ? bookmark() : o.stored),
            },
            bookmarkReview: {
                create: jest.fn(async ({ data }) => {
                    if (o.createError) throw o.createError
                    return data
                }),
                updateMany: jest.fn().mockResolvedValue({ count: o.updated ?? 1 }),
                findUnique: jest.fn().mockResolvedValue(o.storedReview ?? null),
            },
        }
        return { prisma }
    }

    const grade = (
        prisma: unknown,
        payload: { grade: 'again' | 'hard' | 'good' | 'easy'; reviewedAt: string } = {
            grade: 'good',
            reviewedAt: NOW.toISOString(),
        },
        courseAccess: unknown = {
            assertCanWatchVideo: jest
                .fn()
                .mockResolvedValue({ isStaff: false, visibleCourseIds: [] }),
        },
    ) =>
        new ReviewMyBookmarkHandler(prisma as never, courseAccess as never).execute(
            new ReviewMyBookmarkFeature('u1', 'v1', BM, payload),
        )

    it("refuses a grade on a lesson the member can't watch and stores nothing", async () => {
        const { prisma } = build()
        const locked = new ForbiddenError({ message: 'Урок пока закрыт' })
        const courseAccess = { assertCanWatchVideo: jest.fn().mockRejectedValue(locked) }
        await expect(grade(prisma, undefined, courseAccess)).rejects.toBe(locked)
        expect(prisma.bookmarkReview.create).not.toHaveBeenCalled()
        expect(prisma.bookmarkReview.updateMany).not.toHaveBeenCalled()
    })

    it('schedules a new card on its first grade', async () => {
        const { prisma } = build()
        const res = await grade(prisma)
        expect(prisma.bookmarkReview.create.mock.calls[0][0].data).toEqual({
            bookmarkId: BM,
            userId: 'u1',
            workspaceId: 'w1',
            intervalDays: 2,
            ease: 2.5,
            reps: 1,
            lapses: 0,
            dueAt: at(2 * DAY),
            lastReviewedAt: NOW,
        })
        expect(res).toEqual({
            bookmarkId: BM,
            dueAt: at(2 * DAY).toISOString(),
            intervalDays: 2,
            ease: 2.5,
            reps: 1,
            lapses: 0,
            lastReviewedAt: NOW.toISOString(),
        })
    })

    it('reschedules a learned card only if no newer grade landed meanwhile', async () => {
        const { prisma } = build({ stored: bookmark({ review: review() }) })
        const res = await grade(prisma, { grade: 'again', reviewedAt: NOW.toISOString() })
        expect(prisma.bookmarkReview.updateMany.mock.calls[0][0]).toEqual({
            where: { bookmarkId: BM, lastReviewedAt: { lt: NOW } },
            data: {
                intervalDays: 0,
                ease: 2.3,
                reps: 0,
                lapses: 1,
                dueAt: at(10 * 60 * 1000),
                lastReviewedAt: NOW,
            },
        })
        expect(res).toMatchObject({ intervalDays: 0, lapses: 1, reps: 0 })
        expect(prisma.bookmarkReview.create).not.toHaveBeenCalled()
    })

    it.each([
        ['an older', at(-11 * DAY)],
        ['the same (a retry)', at(-10 * DAY)],
    ])('ignores a grade with %s timestamp', async (_, reviewedAt) => {
        const { prisma } = build({ stored: bookmark({ review: review() }) })
        const res = await grade(prisma, {
            grade: 'easy',
            reviewedAt: reviewedAt.toISOString(),
        })
        expect(prisma.bookmarkReview.updateMany).not.toHaveBeenCalled()
        expect(prisma.bookmarkReview.create).not.toHaveBeenCalled()
        expect(res).toMatchObject({ intervalDays: 10, reps: 3 })
    })

    it('returns the stored schedule when a concurrent newer grade won', async () => {
        const winner = review({ intervalDays: 33, reps: 4, lastReviewedAt: at(HOUR) })
        const { prisma } = build({
            stored: bookmark({ review: review() }),
            updated: 0,
            storedReview: winner,
        })
        const res = await grade(prisma)
        expect(res).toMatchObject({ intervalDays: 33, reps: 4 })
    })

    it('returns the stored schedule when a concurrent first grade created it', async () => {
        const { prisma } = build({
            createError: Object.assign(new Error('unique'), { code: 'P2002' }),
            storedReview: review({ intervalDays: 4, reps: 1 }),
        })
        const res = await grade(prisma)
        expect(res).toMatchObject({ intervalDays: 4, reps: 1 })
    })

    it('rethrows other write failures', async () => {
        const { prisma } = build({ createError: new Error('db down') })
        await expect(grade(prisma)).rejects.toThrow('db down')
    })

    it.each([
        ['missing', null],
        ["another user's", bookmark({ userId: 'u2' })],
        ["another lesson's", bookmark({ videoId: 'v2' })],
        ['deleted', bookmark({ deletedAt: at(-DAY) })],
    ])('404s for a %s bookmark', async (_, stored) => {
        const { prisma } = build({ stored })
        await expect(grade(prisma)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.bookmarkReview.create).not.toHaveBeenCalled()
        expect(prisma.bookmarkReview.updateMany).not.toHaveBeenCalled()
    })

    it('404s for an unknown lesson', async () => {
        const { prisma } = build({ video: null })
        await expect(grade(prisma)).rejects.toBeInstanceOf(NotFoundError)
    })

    it("refuses a user who isn't a member of the lesson's club", async () => {
        const { prisma } = build({ membership: null })
        await expect(grade(prisma)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.videoBookmark.findUnique).not.toHaveBeenCalled()
    })

    it('lets the owner (no member row) grade', async () => {
        const { prisma } = build({ membership: null, ownerId: 'u1' })
        await expect(grade(prisma)).resolves.toMatchObject({ reps: 1 })
    })

    it('rejects a grade stamped more than a day ahead', async () => {
        const { prisma } = build()
        await expect(
            grade(prisma, { grade: 'good', reviewedAt: at(DAY + HOUR).toISOString() }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.bookmarkReview.create).not.toHaveBeenCalled()
    })
})
