import { GetAttendanceLeaderboardFeature } from './get-attendance-leaderboard.feature'
import { GetAttendanceLeaderboardHandler } from './get-attendance-leaderboard.handler'

const user = (userId: string, name: string, hidden = false) => ({
    userId,
    hideFromLeaderboard: hidden,
    user: { firstname: name, lastname: null, email: `${userId}@x.io` },
})

const makePrisma = (over: {
    leaderboardEnabled?: boolean
    counts?: { userId: string; n: number }[]
    members?: ReturnType<typeof user>[]
    myRecords?: number
}) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({
            leaderboardEnabled: over.leaderboardEnabled ?? true,
        }),
    },
    attendanceRecord: {
        groupBy: jest.fn().mockResolvedValue(
            (over.counts ?? []).map((c) => ({
                userId: c.userId,
                _count: { _all: c.n },
            })),
        ),
        findMany: jest
            .fn()
            .mockResolvedValue(
                Array.from({ length: over.myRecords ?? 0 }, () => ({
                    markedAt: new Date(),
                })),
            ),
    },
    workspaceMember: {
        findMany: jest.fn().mockResolvedValue(over.members ?? []),
    },
})

// Pass-through cache: every call computes, as on a cold Redis.
const coldCache = () => ({
    getOrCompute: jest.fn(
        (_w: string, _p: string, compute: () => Promise<unknown>) => compute(),
    ),
    invalidate: jest.fn(),
})

const run = (
    prisma: ReturnType<typeof makePrisma>,
    userId = 'me',
    period?: 'week' | 'month',
    cache: { getOrCompute: jest.Mock } = coldCache(),
) =>
    new GetAttendanceLeaderboardHandler(prisma as never, cache as never).execute(
        new GetAttendanceLeaderboardFeature('w1', userId, { period }),
    )

describe('getAttendanceLeaderboard', () => {
    it('returns disabled + empty when the club turned the board off', async () => {
        const out = await run(makePrisma({ leaderboardEnabled: false }))
        expect(out.enabled).toBe(false)
        expect(out.entries).toEqual([])
        expect(out.me).toEqual({
            checkins: 0,
            rank: null,
            streakWeeks: 0,
            hidden: false,
        })
    })

    it('ranks active members and flags the caller', async () => {
        const out = await run(
            makePrisma({
                counts: [
                    { userId: 'a', n: 10 },
                    { userId: 'me', n: 5 },
                ],
                members: [user('a', 'Ann'), user('me', 'Me')],
                myRecords: 3,
            }),
        )
        expect(out.enabled).toBe(true)
        expect(out.entries.map((e) => [e.userId, e.rank, e.isMe])).toEqual([
            ['a', 1, false],
            ['me', 2, true],
        ])
        expect(out.me.rank).toBe(2)
        expect(out.me.checkins).toBe(5)
    })

    it('hides an opted-out member from entries but still returns their own stats', async () => {
        const out = await run(
            makePrisma({
                counts: [
                    { userId: 'a', n: 10 },
                    { userId: 'me', n: 8 },
                ],
                members: [user('a', 'Ann'), user('me', 'Me', true)],
            }),
        )
        // Opted-out caller is absent from the public board...
        expect(out.entries.map((e) => e.userId)).toEqual(['a'])
        // ...but sees their own count, an unranked position, and hidden=true.
        expect(out.me).toMatchObject({ checkins: 8, rank: null, hidden: true })
    })

    it('excludes members with zero check-ins in the period', async () => {
        const out = await run(
            makePrisma({
                counts: [{ userId: 'a', n: 4 }],
                members: [user('a', 'Ann'), user('b', 'Bob')],
            }),
        )
        expect(out.entries.map((e) => e.userId)).toEqual(['a'])
    })

    it('never exposes an e-mail: nameless members show a neutral label, full names are abbreviated', async () => {
        const nameless = {
            ...user('a', ''),
            user: { firstname: null, lastname: null, email: 'secret@x.io' },
        }
        const full = {
            ...user('b', 'Иван'),
            user: { firstname: 'Иван', lastname: 'Петров', email: 'b@x.io' },
        }
        const out = await run(
            makePrisma({
                counts: [
                    { userId: 'a', n: 4 },
                    { userId: 'b', n: 3 },
                ],
                members: [nameless, full],
            }),
        )
        expect(out.entries.map((e) => e.name)).toEqual(['Участник', 'Иван П.'])
        expect(JSON.stringify(out)).not.toContain('@')
    })

    it('serves the club-wide ranking from the cache without the roster queries', async () => {
        const prisma = makePrisma({ myRecords: 1 })
        const cache = {
            getOrCompute: jest.fn().mockResolvedValue({
                ranked: [{ userId: 'a', name: 'Ann', checkins: 7, rank: 1 }],
                counts: { a: 7, me: 2 },
                hiddenUserIds: ['me'],
            }),
        }
        const out = await run(prisma, 'me', 'week', cache)
        expect(cache.getOrCompute).toHaveBeenCalledWith(
            'w1',
            'week',
            expect.any(Function),
        )
        expect(prisma.attendanceRecord.groupBy).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
        expect(out.entries).toEqual([
            { userId: 'a', name: 'Ann', checkins: 7, rank: 1, isMe: false },
        ])
        expect(out.me).toMatchObject({ checkins: 2, rank: null, hidden: true })
    })
})
