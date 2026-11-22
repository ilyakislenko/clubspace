jest.mock('../playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { Logger } from '@nestjs/common'

import {
    reviewReminderMessage,
    ReviewRemindersService,
    selectReviewReminders,
    type ReminderBookmark,
} from './review-reminders.service'

// 18:05 in Moscow (UTC+3).
const NOW = new Date('2026-05-08T15:05:00Z')
const DAY = 24 * 60 * 60_000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const bookmark = (
    userId: string,
    videoId: string,
    review: ReminderBookmark['review'] = null,
    createdAt = ago(3 * DAY),
): ReminderBookmark => ({ userId, videoId, createdAt, review })

describe('selectReviewReminders', () => {
    const select = (
        bookmarks: ReminderBookmark[],
        o: { active?: string[]; optedOut?: string[] } = {},
    ) =>
        selectReviewReminders(bookmarks, {
            activeUserIds: new Set(o.active ?? ['u1', 'u2', 'u3']),
            optedOutUserIds: new Set(o.optedOut ?? []),
            now: NOW,
            timezone: 'Europe/Moscow',
        })

    it('counts due cards: scheduled ones past due, new ones a day after saving', () => {
        expect(
            select([
                bookmark('u1', 'v1', { dueAt: ago(60_000), lastReviewedAt: ago(5 * DAY) }),
                bookmark('u1', 'v2', { dueAt: new Date(NOW.getTime() + 60_000), lastReviewedAt: ago(5 * DAY) }),
                bookmark('u1', 'v3'),
                // Saved an hour ago: not due until tomorrow.
                bookmark('u2', 'v1', null, ago(60 * 60_000)),
            ]),
        ).toEqual([{ userId: 'u1', dueVideoIds: ['v1', 'v3'] }])
    })

    it('skips whoever already reviewed today, club time', () => {
        const due = { dueAt: ago(DAY), lastReviewedAt: ago(5 * DAY) }
        expect(
            select([
                bookmark('u1', 'v1', due),
                // u1 graded another card this morning.
                bookmark('u1', 'v2', { dueAt: ago(-DAY), lastReviewedAt: ago(8 * 60 * 60_000) }),
                bookmark('u2', 'v1', due),
                // 23:30 yesterday in Moscow — not today.
                bookmark('u2', 'v2', {
                    dueAt: ago(-DAY),
                    lastReviewedAt: new Date('2026-05-07T20:30:00Z'),
                }),
            ]).map((c) => c.userId),
        ).toEqual(['u2'])
    })

    it('leaves out former members and those who opted out', () => {
        const cards = [bookmark('u1', 'v1'), bookmark('u2', 'v1'), bookmark('u3', 'v1')]
        expect(select(cards, { active: ['u1', 'u2'], optedOut: ['u2'] })).toEqual([
            { userId: 'u1', dueVideoIds: ['v1'] },
        ])
    })
})

describe('reviewReminderMessage', () => {
    it('agrees the noun with the count', () => {
        expect(reviewReminderMessage(1)).toBe('Пора повторить: 1 карточку')
        expect(reviewReminderMessage(3)).toBe('Пора повторить: 3 карточки')
        expect(reviewReminderMessage(12)).toBe('Пора повторить: 12 карточек')
    })
})

describe('ReviewRemindersService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })
    afterEach(() => jest.restoreAllMocks())

    const make = (
        o: {
            bookmarks?: ReminderBookmark[]
            members?: string[]
            optedOut?: string[]
            watchable?: string[]
            videosOn?: boolean
            timezone?: string
        } = {},
    ) => {
        const claimed = new Set<string>()
        const club = {
            id: 'ws-1',
            name: 'Клуб',
            timezone: o.timezone ?? 'Europe/Moscow',
            ownerId: 'owner',
            type: 'GRAPPLING',
        }
        const prisma = {
            workspace: {
                findMany: jest.fn(async (args: { distinct?: string[] }) =>
                    args.distinct ? [{ timezone: club.timezone }] : [club],
                ),
            },
            notificationDispatchLog: {
                create: jest.fn(async ({ data }: { data: { kind: string; refId: string } }) => {
                    const key = `${data.kind}|${data.refId}`
                    if (claimed.has(key)) throw Object.assign(new Error('dup'), { code: 'P2002' })
                    claimed.add(key)
                    return data
                }),
                deleteMany: jest.fn(async ({ where }: { where: { kind: string; refId: string } }) => {
                    claimed.delete(`${where.kind}|${where.refId}`)
                    return { count: 1 }
                }),
            },
            videoBookmark: {
                findMany: jest.fn().mockResolvedValue(
                    o.bookmarks ?? [
                        bookmark('u1', 'v1'),
                        bookmark('u1', 'v2'),
                        bookmark('u1', 'v3'),
                        bookmark('u2', 'v1'),
                    ],
                ),
            },
            workspaceMember: {
                findMany: jest
                    .fn()
                    .mockResolvedValue((o.members ?? ['u1', 'u2']).map((userId) => ({ userId }))),
            },
            notificationPreferences: {
                findMany: jest
                    .fn()
                    .mockResolvedValue((o.optedOut ?? []).map((userId) => ({ userId }))),
            },
        }
        const notifications = {
            canNotifyUser: jest.fn().mockResolvedValue(o.videosOn ?? true),
            notifyUser: jest.fn().mockResolvedValue(true),
        }
        const courseAccess = {
            watchableVideoIds: jest.fn(
                async (_w: string, _u: string, ids: string[]) =>
                    new Set(ids.filter((id) => (o.watchable ?? ['v1', 'v2', 'v3']).includes(id))),
            ),
        }
        const service = new ReviewRemindersService(
            prisma as never,
            notifications as never,
            courseAccess as never,
        )
        return { service, prisma, notifications, courseAccess }
    }

    it('reminds each member once with the count of cards they can still open', async () => {
        const { service, notifications, prisma } = make({ watchable: ['v1', 'v3'] })
        await expect(service.run(NOW)).resolves.toEqual({ clubs: 1, failed: 0, sent: 2 })
        expect(notifications.notifyUser).toHaveBeenCalledWith({
            userId: 'u1',
            kind: 'review.due',
            refId: 'ws-1:u1:2026-05-08',
            topic: 'Клуб',
            message: 'Пора повторить: 2 карточки',
            category: 'reviewRemindersEnabled',
            workspaceId: 'ws-1',
            metadata: { workspaceId: 'ws-1', count: 2 },
        })
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'ws-1',
            status: 'ACTIVE',
            OR: [{ accessUntil: null }, { accessUntil: { gt: NOW } }],
        })
        expect(prisma.notificationPreferences.findMany.mock.calls[0][0].where).toEqual({
            userId: { in: ['u1', 'u2'] },
            reviewRemindersEnabled: false,
        })
    })

    it('runs a club once a day: a later run the same evening sends nothing', async () => {
        const { service, notifications } = make()
        await service.run(NOW)
        const again = await service.run(new Date(NOW.getTime() + 60 * 60_000))
        expect(again).toEqual({ clubs: 0, failed: 0, sent: 0 })
        expect(notifications.notifyUser).toHaveBeenCalledTimes(2)
    })

    it('waits for the club-local evening', async () => {
        const { service, prisma } = make({ timezone: 'Asia/Vladivostok' })
        await expect(service.run(NOW)).resolves.toEqual({ clubs: 0, failed: 0, sent: 0 })
        expect(prisma.videoBookmark.findMany).not.toHaveBeenCalled()
    })

    it('includes the owner, skips cards no longer watchable and opted-out members', async () => {
        const { service, notifications } = make({
            bookmarks: [bookmark('owner', 'v1'), bookmark('u1', 'v9'), bookmark('u2', 'v1')],
            optedOut: ['u2'],
        })
        await expect(service.run(NOW)).resolves.toMatchObject({ sent: 1 })
        expect(notifications.notifyUser.mock.calls.map((c) => c[0].userId)).toEqual(['owner'])
    })

    it('does nothing for a club with videos off or no bookmarks', async () => {
        const off = make({ videosOn: false })
        await expect(off.service.run(NOW)).resolves.toMatchObject({ clubs: 1, sent: 0 })
        expect(off.notifications.canNotifyUser).toHaveBeenCalledWith({
            userId: 'owner',
            workspaceId: 'ws-1',
            feature: 'videos',
        })
        expect(off.prisma.videoBookmark.findMany).not.toHaveBeenCalled()
        const none = make({ bookmarks: [] })
        await expect(none.service.run(NOW)).resolves.toMatchObject({ sent: 0 })
        expect(none.prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('frees the club-day after a failure so the next run retries', async () => {
        const { service, prisma, notifications } = make()
        prisma.videoBookmark.findMany.mockRejectedValueOnce(new Error('db down'))
        await expect(service.run(NOW)).resolves.toEqual({ clubs: 1, failed: 1, sent: 0 })
        expect(prisma.notificationDispatchLog.deleteMany).toHaveBeenCalledWith({
            where: { kind: 'review.reminders.run', refId: 'ws-1:2026-05-08' },
        })
        await expect(service.run(NOW)).resolves.toMatchObject({ clubs: 1, sent: 2 })
        expect(notifications.notifyUser).toHaveBeenCalledTimes(2)
    })
})
